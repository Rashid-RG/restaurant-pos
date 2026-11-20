import net from 'node:net';
import tls from 'node:tls';

// A small, dependency-free RESP2 transport for staging rider presence.
// Opens one short-lived authenticated connection per command. Intended for
// low-throughput staging only; migrate to a pooled Redis client at scale.
const MAX_REPLY_BYTES=2_000_000;
function encode(args){
  return Buffer.from('*'+args.length+'\r\n'+args.map(value=>{
    const s=String(value),bytes=Buffer.byteLength(s);
    return '$'+bytes+'\r\n'+s+'\r\n';
  }).join(''));
}
function parse(buffer,index=0,depth=0){
  if(depth>8)throw Error('Invalid Redis response nesting');
  const end=buffer.indexOf('\r\n',index);
  if(end<0)return null;
  const type=String.fromCharCode(buffer[index]);
  const head=buffer.toString('utf8',index+1,end);
  let offset=end+2;
  if(type==='+'||type==='-'||type===':'){
    if(type==='-')throw Error('Redis command rejected');
    if(type===':'){const number=Number(head);if(!Number.isSafeInteger(number))throw Error('Invalid Redis integer');return {value:number,end:offset};}
    return {value:head,end:offset};
  }
  if(type==='$'){
    const length=Number(head);
    if(!Number.isInteger(length)||length< -1||length>MAX_REPLY_BYTES)throw Error('Invalid Redis bulk length');
    if(length===-1)return {value:null,end:offset};
    if(buffer.length<offset+length+2)return null;
    if(buffer[offset+length]!==13||buffer[offset+length+1]!==10)throw Error('Invalid Redis bulk terminator');
    return {value:buffer.toString('utf8',offset,offset+length),end:offset+length+2};
  }
  if(type==='*'){
    const length=Number(head);
    if(!Number.isInteger(length)||length< -1||length>20000)throw Error('Invalid Redis array length');
    if(length===-1)return {value:null,end:offset};
    const result=[];
    for(let i=0;i<length;i++){
      const item=parse(buffer,offset,depth+1);
      if(!item)return null;
      result.push(item.value);offset=item.end;
    }
    return {value:result,end:offset};
  }
  throw Error('Unsupported Redis response');
}

export function createRedisRespClient({url,timeoutMs=2500}={}) {
  if(typeof url!=='string')throw new TypeError('Redis URL required');
  const parsed=new URL(url);
  if(!['redis:','rediss:'].includes(parsed.protocol)||!parsed.hostname||
      parsed.search||parsed.hash||parsed.pathname!=='/'||
      !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
    throw new TypeError('Invalid Redis connection settings');
  // Plain Redis is acceptable only over Render-style private hostnames or
  // loopback during tests. External Redis must use certificate-checked TLS.
  const host=parsed.hostname.toLowerCase();
  if(parsed.protocol==='redis:'&&host!=='localhost'&&host!=='127.0.0.1'&&
     !/^(?:red-[a-z0-9]+|[a-z0-9-]+\\.internal)$/.test(host))
    throw new TypeError('Unencrypted external Redis connections are forbidden');
  const port=Number(parsed.port||6379);
  if(port<1||port>65535)throw new TypeError('Invalid Redis port');
  const username=decodeURIComponent(parsed.username||'');
  const password=decodeURIComponent(parsed.password||'');
  const connect=()=>{
    return new Promise((resolve,reject)=>{
      const socket=parsed.protocol==='rediss:'
        ?tls.connect({host:parsed.hostname,port,servername:parsed.hostname,rejectUnauthorized:true})
        :net.connect({host:parsed.hostname,port});
      socket.setTimeout(timeoutMs);
      const fail=(error)=>{socket.destroy();reject(error instanceof Error?error:new Error('Redis connection failed'));};
      socket.once('error',fail);
      socket.once('timeout',()=>fail(new Error('Redis connection timed out')));
      socket.once(parsed.protocol==='rediss:'?'secureConnect':'connect',()=>{
        socket.removeListener('error',fail);
        resolve(socket);
      });
    });
  };
  const execute=async args=>{
    const socket=await connect();
    let buffer=Buffer.alloc(0);
    const authentication=username?['AUTH',username,password]:['AUTH',password];
    const commands=password?[authentication,args]:[args];
    return new Promise((resolve,reject)=>{
      let settled=false,replies=0;
      const cleanup=()=>{if(settled)return;settled=true;socket.destroy();};
      const fail=error=>{cleanup();reject(error);};
      socket.on('error',fail);
      socket.on('timeout',()=>fail(new Error('Redis command timed out')));
      socket.on('close',()=>{if(!settled)fail(new Error('Redis disconnected'));});
      socket.on('data',chunk=>{
        if(settled)return;
        buffer=Buffer.concat([buffer,chunk]);
        if(buffer.length>MAX_REPLY_BYTES)return fail(new Error('Redis reply too large'));
        try{
          let offset=0;
          while(replies<commands.length){
            const value=parse(buffer,offset);
            if(!value)break;
            offset=value.end;
            replies++;
            if(replies===commands.length){cleanup();resolve(value.value);return;}
          }
          if(offset)buffer=buffer.subarray(offset);
        }catch(error){fail(error);}
      });
      for(const cmd of commands)socket.write(encode(cmd));
    });
  };
  return {
    eval:(script,{keys,arguments:args})=>execute(['EVAL',script,keys.length,...keys,...args]),
    del:key=>execute(['DEL',key]),
    mGet:keys=>keys.length?execute(['MGET',...keys]):Promise.resolve([]),
    scan:async(cursor,{MATCH,COUNT})=>{
      const result=await execute(['SCAN',cursor,'MATCH',MATCH,'COUNT',COUNT]);
      if(!Array.isArray(result)||result.length!==2||!Array.isArray(result[1]))
        throw Error('Invalid Redis SCAN response');
      return {cursor:String(result[0]),keys:result[1]};
    }
  };
}
