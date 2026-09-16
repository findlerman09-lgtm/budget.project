'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).filter(Boolean)[0];
const elements={};
const context={
  console,Date,Math,JSON,
  localStorage:{getItem(){return null;},setItem(){}},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  window:{addEventListener(){}},
  document:{getElementById(id){return elements[id]||null;},createElement(){return{};},body:{appendChild(){},removeChild(){}}},
  URL:{createObjectURL(){return'blob:test';},revokeObjectURL(){}},Blob:function(){},
  confirm(){return true;},alert(){},setTimeout(){}
};
vm.createContext(context);
vm.runInContext(inline,context,{filename:'index-inline.js'});
vm.runInContext(fs.readFileSync('month-end-report.js','utf8'),context,{filename:'month-end-report.js'});
vm.runInContext(fs.readFileSync('planning.js','utf8'),context,{filename:'planning.js'});

vm.runInContext(`
  db=dc(SEED);
  db.cfg.year=2026;db.cfg.month=9;db.cfg.chrisPay=1000;db.cfg.sarahPay=500;
  db.buckets=[{id:'travel',name:'Travel',type:'spending',monthly:100}];
  db.transactions=[{id:'t1',date:'2026-09-01',who:'Both',type:'expense',amount:25,bucket:'travel',card:'',desc:'Test'}];
  db.paychecks=[{id:'p1',date:'2026-09-04',who:'Chris',amount:1000},{id:'p2',date:'2026-09-11',who:'Sarah',amount:500}];
  db.accounts=[{id:'a1',bank:'Bank',name:'Checking',balance:5000,openingBalance:0,buffer:0,bucketType:'spending'}];
  this.initialCore=JSON.stringify({transactions:db.transactions,paychecks:db.paychecks,accounts:db.accounts,buckets:db.buckets});
  this.backupPage=pgBackup();
`,context);
assert.match(context.backupPage,/Planning &amp; Month Close|Planning & Month Close/,'legacy data should render the optional planning card');

Object.assign(elements,{
  'pe-date':{value:'2026-11-01'},'pe-name':{value:'Car sale'},'pe-type':{value:'income'},'pe-amount':{value:'2500'},
  'pe-bucket':{value:''},'pe-affects':{value:'yes'},'pe-status':{value:'planned'},'pe-notes':{value:'Known one-time item'}
});
vm.runInContext('closeModal=()=>{};pageR=()=>{};savePlanEvent();',context);
assert.equal(vm.runInContext('db.plannedEvents.length',context),1);
assert.equal(vm.runInContext('db.plannedEvents[0].amount',context),2500);
assert.equal(vm.runInContext('JSON.stringify({transactions:db.transactions,paychecks:db.paychecks,accounts:db.accounts,buckets:db.buckets})',context),context.initialCore,'saving a planning event must not change daily ledger data');

Object.assign(elements,{'mc-accounts':{checked:true},'mc-cards':{checked:true},'mc-events':{checked:true},'mc-advance':{checked:false}});
vm.runInContext('render=()=>{};saveMonthClose(2026,9);',context);
assert.equal(vm.runInContext('db.monthClosures.length',context),1);
assert.equal(vm.runInContext('db.cfg.month',context),9,'month advancement must remain opt-in');
assert.equal(vm.runInContext('JSON.stringify({transactions:db.transactions,paychecks:db.paychecks,accounts:db.accounts,buckets:db.buckets})',context),context.initialCore,'month close must not change daily ledger data');

vm.runInContext('this.download=null;dlFile=(name,content,type)=>this.download={name,content,type};exportClosedMonth(db.monthClosures[0].id);',context);
assert.equal(context.download.name,'budget_analysis_2026-09_closed.html');
assert.match(context.download.content,/Saved month-close snapshot/);
assert.match(context.download.content,/Car sale/);

console.log('planning-layer compatibility tests passed');
