import {describe,it,expect} from 'vitest';
import {createServer} from 'node:net';
import {createRedisRespClient} from './redis-resp-client.js';

async function fakeServer(handler){
  const server=createServer(socket=>{
    let seen=false;
    socket.on('data',buffer=>{
      if(seen)return;seen=true;
      const response=handler(buffer.toString('utf8'));
      socket.end(response);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  return {
    client:createRedisRespClient({url:`redis://127.0.0.1:${port}/`,timeoutMs:1500}),
    close:()=>new Promise(resolve=>server.close(resolve))
  };
}
describe('private Redis RESP command transport',()=>{
  it('rejects cleartext remote Redis connections and invalid config',()=>{
    expect(()=>createRedisRespClient({url:'redis://redis.example.com:6379/'})).toThrow();
    expect(()=>createRedisRespClient({url:'http://localhost:6379/'})).toThrow();
    expect(()=>createRedisRespClient({url:'redis://localhost:6379/3'})).toThrow();
  });
  it('encodes atomic Lua command and parses simple replies',async()=>{
    const fake=await fakeServer(content=>{
      expect(content).toContain('EVAL');
      expect(content).toContain('presence-key');
      return '+accepted\r\n';
    });
    try {
      const value=await fake.client.eval('return "accepted"',{
        keys:['presence-key'],arguments:['payload','123','90000']
      });
      expect(value).toBe('accepted');
    }finally{await fake.close();}
  });
  it('parses nested SCAN arrays',async()=>{
    const fake=await fakeServer(()=>'*2\r\n$1\r\n0\r\n*2\r\n$2\r\nk1\r\n$2\r\nk2\r\n');
    try{expect(await fake.client.scan('0',{MATCH:'gastroflow:*',COUNT:100}))
      .toEqual({cursor:'0',keys:['k1','k2']});}
    finally{await fake.close();}
  });
  it('parses MGET values and null entries',async()=>{
    const fake=await fakeServer(()=>'*2\r\n$2\r\nok\r\n$-1\r\n');
    try{expect(await fake.client.mGet(['k1','k2'])).toEqual(['ok',null]);}
    finally{await fake.close();}
  });
  it('does not hide server errors',async()=>{
    const fake=await fakeServer(()=>'-ERR no permissions\r\n');
    try{await expect(fake.client.del('rider-key')).rejects.toThrow('Redis command rejected');}
    finally{await fake.close();}
  });
});
