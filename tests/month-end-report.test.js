'use strict';

const assert=require('node:assert/strict');
const {buildMonthEndAnalysis,renderMonthEndReport}=require('../month-end-report.js');

const db={
  cfg:{year:2026,month:1,chrisPay:500,sarahPay:0,pendingAmex:25,payForecast:{Chris:{nextDate:'2026-02-06',cadenceDays:14}}},
  buckets:[{id:'groceries',name:'Groceries',type:'spending',monthly:100}],
  transactions:[
    {id:'expense',date:'2026-01-05',type:'expense',amount:60,bucket:'groceries',card:'visa',desc:'Market'},
    {id:'refund',date:'2026-01-08',type:'income',amount:10,bucket:'groceries',card:'visa',desc:'Return'},
    {id:'payment',date:'2026-01-20',type:'cc_payment',amount:50,bucket:'',card:'visa',desc:'Card payment'}
  ],
  paychecks:[{id:'pay',date:'2026-01-02',who:'Chris',amount:500}],
  allocations:[{id:'allocation',date:'2026-01-03',bucket:'groceries',amount:50,pcId:null,notes:'Extra funding'}],
  accounts:[{bank:'Bank',name:'Checking',balance:1000,buffer:100,bucketType:'spending'}],
  cards:[{id:'visa',label:'Visa'}],
  plannedEvents:[
    {id:'sale',date:'2026-03-01',name:'Car sale',type:'income',amount:2500,status:'planned',affectsProjection:true},
    {id:'trip',date:'2026-06-01',name:'Disney',type:'expense',amount:1800,status:'planned',affectsProjection:true},
    {id:'reference',date:'2026-08-01',name:'Already captured',type:'expense',amount:999,status:'planned',affectsProjection:false},
    {id:'done',date:'2026-09-01',name:'Completed item',type:'income',amount:999,status:'completed',affectsProjection:true}
  ]
};

const analysis=buildMonthEndAnalysis(db,2026,1,{futureIncomeAdjustment:250,futureExpenseAdjustment:500,notes:'Known <items>'});

assert.equal(analysis.current.income,510,'paychecks and refund/credit income should be included');
assert.equal(analysis.current.expenses,60,'card payments must not be counted as expenses');
assert.equal(analysis.current.net,450);
assert.equal(analysis.budget.monthBudget,150,'base funding and extra allocation should both be included');
assert.equal(analysis.budget.monthNetBucketSpend,50,'refunds should reduce net bucket spending');
assert.equal(analysis.budget.monthBudgetVariance,100);
assert.equal(analysis.ytd.bucketBalance,100,'ending envelope balance should preserve funded but unspent money');
assert.equal(analysis.paycheckForecast.count,24);
assert.equal(analysis.projection.futureRegularIncome,12000);
assert.equal(analysis.projection.plannedEventIncome,2500);
assert.equal(analysis.projection.plannedEventExpenses,1800);
assert.equal(analysis.projection.projectedIncome,15260);
assert.equal(analysis.projection.budgetGuidedExpenses,3460);
assert.equal(analysis.projection.runRateExpenses,3020);
assert.equal(analysis.projection.projectedExpenses,3460,'the higher baseline plus future events should be used');
assert.equal(analysis.projection.projectedNet,11800);
assert.equal(analysis.cardsOwed,25,'a paid-down tracked card plus pending amount should be reflected');
assert.equal(analysis.projection.projectedAdjustedCash,12325);

const html=renderMonthEndReport(analysis);
assert.match(html,/BudgetLock Analysis/);
assert.match(html,/Year-end projection/);
assert.match(html,/Projection bridge/);
assert.match(html,/Remaining paycheck schedule/);
assert.match(html,/Car sale/);
assert.match(html,/Known &lt;items&gt;/,'user notes should be HTML escaped');
assert.doesNotMatch(html,/Known <items>/);

console.log('month-end-report tests passed');
