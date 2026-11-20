const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler() {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/users/memory.js"), "utf8");
  const lists = new Map();
  const module = { exports: null };
  const sandbox = {
    module, exports: module.exports,
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (id === "../../lib/user-auth") return {
        getUserSessionUid: async req => req.uid || "",
        sameOrigin: req => req.sameOrigin !== false
      };
      if (id === "../../lib/quota") return {
        consumeAccountRateLimit: async () => ({count:1,limit:60,windowSeconds:3600}),
        redis: async command => {
          const [op,key,...args]=command;const list=lists.get(key)||[];lists.set(key,list);
          if(op==="LPUSH"){list.unshift(args[0]);return list.length;}
          if(op==="LTRIM"){const start=Number(args[0]),end=Number(args[1]);list.splice(end+1);if(start)list.splice(0,start);return "OK";}
          if(op==="LRANGE")return list.slice(Number(args[0]),Number(args[1])+1);
          if(op==="EVAL"){
            const targetKey=args[1],id=args[2],replacement=args[3],target=lists.get(targetKey)||[];
            const index=target.findIndex(raw=>{try{return JSON.parse(raw).id===id;}catch{return false;}});
            if(index<0)return 0;
            if(replacement){const next=JSON.parse(replacement);next.created_at=JSON.parse(target[index]).created_at;target[index]=JSON.stringify(next);}
            else target.splice(index,1);
            return 1;
          }
          return "OK";
        }
      };
      throw new Error("Unexpected dependency: "+id);
    }
  };
  vm.runInNewContext(source,sandbox,{filename:"handlers/users/memory.js"});
  return {handler:module.exports,lists};
}
function response(){return {statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
test("user memory is private to the authenticated server-side account and supports CRUD",async()=>{
 const {handler,lists}=loadHandler();const uidA="a".repeat(48),uidB="b".repeat(48);
 const added=response();await handler({method:"POST",uid:uidA,body:{action:"add",title:"یادداشت من",content:"مطلب محرمانه"}},added);
 assert.equal(added.statusCode,201);
 const keyA="vy:user:"+uidA+":memory",keyB="vy:user:"+uidB+":memory";
 assert.equal(lists.get(keyA).length,1);assert.equal(lists.get(keyB),undefined);
 const listA=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},listA);assert.equal(listA.body.count,1);
 const listB=response();await handler({method:"POST",uid:uidB,body:{action:"list"}},listB);assert.equal(listB.body.count,0);
 const updated=response();await handler({method:"POST",uid:uidA,body:{action:"update",id:added.body.record.id,title:"عنوان ویرایش‌شده",content:"متن جدید"}},updated);assert.equal(updated.statusCode,200);
 const after=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},after);assert.equal(after.body.records[0].title,"عنوان ویرایش‌شده");
 const deleted=response();await handler({method:"POST",uid:uidA,body:{action:"delete",id:added.body.record.id}},deleted);assert.equal(deleted.statusCode,200);
 const final=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},final);assert.equal(final.body.count,0);
});
test("user memory rejects anonymous, cross-origin, invalid and oversized requests",async()=>{
 const {handler}=loadHandler();const anonymous=response();await handler({method:"POST",uid:"",body:{action:"list"}},anonymous);assert.equal(anonymous.statusCode,401);
 const cross=response();await handler({method:"POST",uid:"a".repeat(48),sameOrigin:false,body:{action:"list"}},cross);assert.equal(cross.statusCode,403);
 const invalid=response();await handler({method:"POST",uid:"a".repeat(48),body:{action:"add",title:"",content:""}},invalid);assert.equal(invalid.statusCode,400);
 const oversized=response();await handler({method:"POST",uid:"a".repeat(48),body:{action:"add",title:"x".repeat(121),content:"ok"}},oversized);assert.equal(oversized.statusCode,400);
});
