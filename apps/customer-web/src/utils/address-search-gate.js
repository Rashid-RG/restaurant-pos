// Only the most recent geocoding search may update visible address results.
// Selection, query edits and component unmount invalidate pending searches;
// none of these operations can alter a confirmed coordinate.
export function createAddressSearchGate(){
  let generation=0;
  let mounted=true;
  return {
    start(){return ++generation;},
    isCurrent(request){return mounted && Number.isSafeInteger(request) && request===generation;},
    invalidate(){generation++;},
    // React Strict Mode replays mount effects; start a fresh generation there.
    activate(){mounted=true;generation++;},
    dispose(){mounted=false;generation++;},
  };
}
