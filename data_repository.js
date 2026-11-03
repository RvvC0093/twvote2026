(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ElectionDataRepository=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const abortError=()=>Object.assign(new Error('Request cancelled'),{name:'AbortError'});
  class DataRepository {
    constructor(loader,{budget=32*1024*1024,limits={geometry:2,history:3,roster:3,summary:12}}={}){
      this.loader=loader;this.budget=budget;this.limits=limits;this.pending=new Map();this.cache=new Map();this.cost=0;
    }
    category(path){return /geo\/villages\/.*topo/.test(path)?'geometry':path.includes('/history/')?'history':/observation\/c-/.test(path)?'roster':'summary';}
    loadResource({release='',path,sha256=null,schema=null,signal=null,bytes=0}){
      if(signal?.aborted)return Promise.reject(abortError());
      const key=JSON.stringify([release,path,sha256,schema]);
      if(this.cache.has(key)){
        const entry=this.cache.get(key);this.cache.delete(key);this.cache.set(key,entry);return Promise.resolve(entry.value);
      }
      let request=this.pending.get(key);
      if(!request){
        const controller=new AbortController();request={controller,users:0,promise:null};
        request.promise=Promise.resolve().then(()=>this.loader(path,controller.signal,sha256)).then(value=>{
          if(schema && value.schema!==schema)throw new Error('資料格式版本不符');
          if(sha256 && !controller.signal.aborted){
            const cost=bytes?bytes*4:JSON.stringify(value).length*4;
            if(cost<=this.budget){
              const category=this.category(path);
              this.cache.set(key,{value,cost,category});this.cost+=cost;
              while(this.cost>this.budget || [...this.cache.values()].filter(e=>e.category===category).length>(this.limits[category]||3)){
                const candidate=[...this.cache].find(([,e])=>this.cost>this.budget||e.category===category);
                this.cache.delete(candidate[0]);this.cost-=candidate[1].cost;
              }
            }
          }
          return value;
        }).finally(()=>{if(this.pending.get(key)===request)this.pending.delete(key);});
        this.pending.set(key,request);
      }
      request.users++;
      return new Promise((resolve,reject)=>{
        let finished=false;
        const finish=(fn,value)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);request.users--;fn(value);};
        const cancel=()=>{
          finish(reject,abortError());
          if(request.users===0){request.controller.abort();if(this.pending.get(key)===request)this.pending.delete(key);}
        };
        signal?.addEventListener('abort',cancel,{once:true});
        request.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
      });
    }
    stats(){return {pending:this.pending.size,entries:this.cache.size,estimatedBytes:this.cost};}
  }
  return {DataRepository};
});
