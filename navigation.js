(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.ElectionNavigation=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function parse(hash) {
    const [path, search=''] = (hash || '#/mayor').replace(/^#\/?/,'').split('?');
    const parts=path.split('/').map(decodeURIComponent);
    const query=new URLSearchParams(search);
    const result={office:parts[0]||'mayor',canonical:parts[1]==='c',county:null,district:null,town:null,village:null,scope:null,no:null};
    if(result.canonical){
      if(parts.length%2!==1)throw new Error('網址層級不完整');
      const seen=new Set();
      for(let i=1;i<parts.length;i+=2){
        const key={c:'county',d:'district',t:'town',v:'village'}[parts[i]];
        if(!key||!parts[i+1]||seen.has(key))throw new Error('網址層級無效');
        seen.add(key);result[key]=parts[i+1];
      }
      if(result.village&&!result.town)throw new Error('村里網址缺少鄉鎮');
    }else{
      if ((result.office !== "council" && parts.length > 2) || (result.office === "council" && ![1,2,4].includes(parts.length))) throw new Error("網址層級無效");
      result.county=parts[1]||null;result.scope=parts[2]||null;result.no=parts[3]||null;
      result.district=query.get('district');result.town=query.get('town');result.village=query.get('village');
    }
    return result;
  }
  function serialize(route){
    let path='#/'+encodeURIComponent(route.office||'mayor');
    for(const [tag,key] of [['c','county'],['d','district'],['t','town'],['v','village']]){
      if(route[key])path+='/'+tag+'/'+encodeURIComponent(route[key]);
    }
    return path;
  }
  return {parse,serialize};
});
