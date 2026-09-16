'use strict';

/* Month-end reporting is kept separate from the core single-file app so the
   calculations remain testable and the exported report can evolve without
   disturbing transaction entry. */

const REPORT_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const REPORT_TYPES={accrual:'Accrual / Long-term',bills:'Bills',spending:'Spending',savings:'Savings'};

function reportNumber(value){
  const number=Number(value);
  return Number.isFinite(number)?number:0;
}

function reportRound(value){return Math.round((reportNumber(value)+Number.EPSILON)*100)/100;}

function reportDate(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));
  return match?{year:+match[1],month:+match[2],day:+match[3]}:null;
}

function reportInMonth(value,year,month){
  const date=reportDate(value);
  return !!date&&date.year===year&&date.month===month;
}

function reportThroughMonth(value,year,month){
  const date=reportDate(value);
  return !!date&&date.year===year&&date.month<=month;
}

function reportMoney(value,signed=false){
  const number=reportNumber(value);
  const amount=Math.abs(number).toLocaleString('en-US',{style:'currency',currency:'USD'});
  if(!signed)return amount;
  return number>0?`+${amount}`:number<0?`−${amount}`:amount;
}

function reportPercent(value){
  const number=reportNumber(value);
  return `${number.toFixed(1)}%`;
}

function reportEscape(value){
  return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function reportBucketName(reportDb,id){
  return(reportDb.buckets||[]).find(bucket=>bucket.id===id)?.name||id||'Unassigned';
}

function reportAccountName(account){
  return [account.bank,account.name].filter(Boolean).join(' ')||'Unnamed account';
}

function reportCardName(reportDb,id){
  const defaults=[{id:'amazon',label:'Amazon'},{id:'chase',label:'Chase'},{id:'lowes',label:"Lowe's"},{id:'macys',label:"Macy's"}];
  return((reportDb.cards||defaults).find(card=>card.id===id)?.label)||id||'Unassigned';
}

function reportCashForMonth(reportDb,year,month){
  const paychecks=(reportDb.paychecks||[]).filter(item=>reportInMonth(item.date,year,month));
  const transactions=(reportDb.transactions||[]).filter(item=>reportInMonth(item.date,year,month));
  const paycheckIncome=paychecks.reduce((sum,item)=>sum+reportNumber(item.amount),0);
  const otherIncome=transactions.filter(item=>item.type==='income').reduce((sum,item)=>sum+reportNumber(item.amount),0);
  const expenses=transactions.filter(item=>item.type==='expense').reduce((sum,item)=>sum+reportNumber(item.amount),0);
  return{
    paycheckIncome:reportRound(paycheckIncome),
    otherIncome:reportRound(otherIncome),
    income:reportRound(paycheckIncome+otherIncome),
    expenses:reportRound(expenses),
    net:reportRound(paycheckIncome+otherIncome-expenses)
  };
}

function reportAllocation(reportDb,bucketId,year,month=null){
  return reportRound((reportDb.allocations||[]).filter(item=>{
    if(item.bucket!==bucketId)return false;
    return month==null?reportThroughMonth(item.date,year,12):reportInMonth(item.date,year,month);
  }).reduce((sum,item)=>sum+reportNumber(item.amount),0));
}

function reportAllocationThrough(reportDb,bucketId,year,month){
  return reportRound((reportDb.allocations||[]).filter(item=>item.bucket===bucketId&&reportThroughMonth(item.date,year,month)).reduce((sum,item)=>sum+reportNumber(item.amount),0));
}

function reportBucketSpend(reportDb,bucketId,year,month=null,through=false){
  return reportRound((reportDb.transactions||[]).filter(item=>{
    if(item.bucket!==bucketId||item.type==='cc_payment')return false;
    return month==null?reportThroughMonth(item.date,year,12):(through?reportThroughMonth(item.date,year,month):reportInMonth(item.date,year,month));
  }).reduce((sum,item)=>sum+(item.type==='expense'?reportNumber(item.amount):-reportNumber(item.amount)),0));
}

function reportCardOutstanding(reportDb,year,month){
  const balances={};
  for(const transaction of reportDb.transactions||[]){
    if(!transaction.card||transaction.card==='none'||!reportThroughMonth(transaction.date,year,month))continue;
    if(transaction.type==='cc_payment')balances[transaction.card]=(balances[transaction.card]||0)-reportNumber(transaction.amount);
    else if(transaction.type==='expense')balances[transaction.card]=(balances[transaction.card]||0)+reportNumber(transaction.amount);
    else if(transaction.type==='income')balances[transaction.card]=(balances[transaction.card]||0)-reportNumber(transaction.amount);
  }
  return Object.entries(balances).map(([id,amount])=>({id,label:reportCardName(reportDb,id),amount:reportRound(amount)})).filter(card=>Math.abs(card.amount)>.005).sort((a,b)=>b.amount-a.amount);
}

function reportPaycheckUnreconciled(reportDb,year,month){
  const expected=who=>who==='Chris'?reportNumber(reportDb.cfg?.chrisPay):reportNumber(reportDb.cfg?.sarahPay);
  let over=0,under=0;
  for(const paycheck of reportDb.paychecks||[]){
    if(paycheck.kind==='other'||!reportThroughMonth(paycheck.date,year,month))continue;
    const target=expected(paycheck.who);
    const delta=target>0?reportNumber(paycheck.amount)-target:0;
    const allocated=(reportDb.allocations||[]).filter(item=>item.pcId===paycheck.id).reduce((sum,item)=>sum+reportNumber(item.amount),0);
    const remaining=delta-allocated;
    if(remaining>.005)over+=remaining;
    else if(remaining<-.005)under-=remaining;
  }
  return{over:reportRound(over),under:reportRound(under),total:reportRound(over+under)};
}

function buildMonthEndAnalysis(reportDb,year,month,options={}){
  year=Number(year);
  month=Math.max(1,Math.min(12,Number(month)));
  const futureIncomeAdjustment=reportNumber(options.futureIncomeAdjustment);
  const futureExpenseAdjustment=reportNumber(options.futureExpenseAdjustment);
  const notes=String(options.notes||'').trim();
  const monthly=[];
  for(let currentMonth=1;currentMonth<=month;currentMonth++)monthly.push({month:currentMonth,...reportCashForMonth(reportDb,year,currentMonth)});
  const current=monthly[month-1];
  const prior=month>1?monthly[month-2]:null;
  const ytdIncome=reportRound(monthly.reduce((sum,item)=>sum+item.income,0));
  const ytdExpenses=reportRound(monthly.reduce((sum,item)=>sum+item.expenses,0));
  const ytdNet=reportRound(ytdIncome-ytdExpenses);
  const savingsRate=ytdIncome?reportRound(ytdNet/ytdIncome*100):0;
  const remainingMonths=12-month;
  const averageIncome=reportRound(ytdIncome/month);
  const averageExpenses=reportRound(ytdExpenses/month);
  const plannedMonthly=reportRound((reportDb.buckets||[]).reduce((sum,bucket)=>sum+reportNumber(bucket.monthly),0));
  const projectedIncome=reportRound(ytdIncome+averageIncome*remainingMonths+futureIncomeAdjustment);
  const budgetGuidedExpenses=reportRound(ytdExpenses+plannedMonthly*remainingMonths+futureExpenseAdjustment);
  const runRateExpenses=reportRound(averageExpenses*12+futureExpenseAdjustment);
  const projectedExpenses=reportRound(Math.max(budgetGuidedExpenses,runRateExpenses));
  const projectedNet=reportRound(projectedIncome-projectedExpenses);
  const projectedSavingsRate=projectedIncome?reportRound(projectedNet/projectedIncome*100):0;

  const buckets=(reportDb.buckets||[]).map(bucket=>{
    const base=reportNumber(bucket.monthly);
    const monthExtra=reportAllocation(reportDb,bucket.id,year,month);
    const ytdExtra=reportAllocationThrough(reportDb,bucket.id,year,month);
    const monthBudget=reportRound(base+monthExtra);
    const monthSpent=reportBucketSpend(reportDb,bucket.id,year,month,false);
    const monthVariance=reportRound(monthBudget-monthSpent);
    const ytdBudget=reportRound(base*month+ytdExtra);
    const ytdSpent=reportBucketSpend(reportDb,bucket.id,year,month,true);
    const ytdBalance=reportRound(ytdBudget-ytdSpent);
    const projectedSpend=reportRound(month?ytdSpent/month*12:0);
    const projectedFunding=reportRound(base*12+ytdExtra);
    const projectedBalance=reportRound(projectedFunding-projectedSpend);
    return{
      id:bucket.id,name:bucket.name||bucket.id,type:bucket.type||'other',base,monthExtra,monthBudget,monthSpent,monthVariance,
      ytdExtra,ytdBudget,ytdSpent,ytdBalance,projectedSpend,projectedFunding,projectedBalance
    };
  }).sort((a,b)=>a.monthVariance-b.monthVariance||a.name.localeCompare(b.name));

  const categories=Object.keys(REPORT_TYPES).map(type=>{
    const rows=buckets.filter(bucket=>bucket.type===type);
    const sum=field=>reportRound(rows.reduce((total,row)=>total+reportNumber(row[field]),0));
    return{type,label:REPORT_TYPES[type],count:rows.length,monthBudget:sum('monthBudget'),monthSpent:sum('monthSpent'),monthVariance:sum('monthVariance'),ytdBudget:sum('ytdBudget'),ytdSpent:sum('ytdSpent'),ytdBalance:sum('ytdBalance'),projectedBalance:sum('projectedBalance')};
  }).filter(category=>category.count);

  const monthBudget=reportRound(buckets.reduce((sum,bucket)=>sum+bucket.monthBudget,0));
  const monthNetBucketSpend=reportRound(buckets.reduce((sum,bucket)=>sum+bucket.monthSpent,0));
  const monthBudgetVariance=reportRound(monthBudget-monthNetBucketSpend);
  const ytdBudget=reportRound(buckets.reduce((sum,bucket)=>sum+bucket.ytdBudget,0));
  const ytdNetBucketSpend=reportRound(buckets.reduce((sum,bucket)=>sum+bucket.ytdSpent,0));
  const ytdBucketBalance=reportRound(ytdBudget-ytdNetBucketSpend);

  const topExpenses=(reportDb.transactions||[]).filter(item=>item.type==='expense'&&reportInMonth(item.date,year,month)).sort((a,b)=>reportNumber(b.amount)-reportNumber(a.amount)).slice(0,12).map(item=>({date:item.date,description:item.desc||reportBucketName(reportDb,item.bucket),bucket:reportBucketName(reportDb,item.bucket),who:item.who||'',card:item.card?reportCardName(reportDb,item.card):'',amount:reportNumber(item.amount)}));
  const currentCards=reportCardOutstanding(reportDb,year,month);
  const cardsOwed=reportRound(currentCards.reduce((sum,card)=>sum+card.amount,0)+(Number(reportDb.cfg?.year)===year&&Number(reportDb.cfg?.month)===month?reportNumber(reportDb.cfg?.pendingAmex):0));
  const accounts=(reportDb.accounts||[]).map(account=>({name:reportAccountName(account),fund:REPORT_TYPES[account.bucketType]||'',balance:reportNumber(account.balance),buffer:reportNumber(account.buffer)}));
  const accountTotal=reportRound(accounts.reduce((sum,account)=>sum+account.balance,0));
  const adjustedCash=reportRound(accountTotal-cardsOwed);
  const isCurrentLedger=Number(reportDb.cfg?.year)===year&&Number(reportDb.cfg?.month)===month;
  const projectedAdjustedCash=isCurrentLedger?reportRound(adjustedCash+(projectedIncome-ytdIncome)-(projectedExpenses-ytdExpenses)):null;
  const unreconciled=reportPaycheckUnreconciled(reportDb,year,month);
  const unassignedTransactions=(reportDb.transactions||[]).filter(item=>item.type!=='cc_payment'&&reportThroughMonth(item.date,year,month)&&!(reportDb.buckets||[]).some(bucket=>bucket.id===item.bucket)).length;

  const now=new Date();
  const isPartial=year===now.getFullYear()&&month===now.getMonth()+1&&now.getDate()<new Date(year,month,0).getDate();
  const findings=[];
  findings.push(`${REPORT_MONTHS[month-1]} cash flow was ${reportMoney(current.net,true)}: ${reportMoney(current.income)} received and ${reportMoney(current.expenses)} spent.`);
  if(monthBudget>0)findings.push(`Net bucket spending was ${monthBudgetVariance>=0?reportMoney(monthBudgetVariance)+' under':reportMoney(Math.abs(monthBudgetVariance))+' over'} the month's funded amount of ${reportMoney(monthBudget)}.`);
  if(prior&&prior.expenses>0){
    const difference=reportRound(current.expenses-prior.expenses);
    findings.push(`Expenses were ${reportMoney(Math.abs(difference))} ${difference>0?'higher':'lower'} than ${REPORT_MONTHS[month-2]}.`);
  }
  const overspent=buckets.filter(bucket=>bucket.monthVariance<-.005);
  if(overspent.length)findings.push(`${overspent.length} bucket${overspent.length===1?' was':'s were'} over the month's funded amount; the largest overage was ${overspent[0].name} at ${reportMoney(Math.abs(overspent[0].monthVariance))}.`);
  else if(buckets.length)findings.push('No bucket exceeded its funded amount for the selected month.');
  findings.push(`The conservative year-end forecast is ${reportMoney(projectedNet,true)}, using the higher of the budget-guided and run-rate expense forecasts.`);
  if(unreconciled.total>.01)findings.push(`${reportMoney(unreconciled.total)} of paycheck over/short amounts remains unreconciled with buckets through this report period.`);
  if(unassignedTransactions)findings.push(`${unassignedTransactions} transaction${unassignedTransactions===1?' has':'s have'} no matching bucket and should be reviewed.`);

  return{
    year,month,monthName:REPORT_MONTHS[month-1],generatedAt:new Date().toISOString(),isPartial,isCurrentLedger,notes,
    current,prior,monthly,ytd:{income:ytdIncome,expenses:ytdExpenses,net:ytdNet,savingsRate,budget:ytdBudget,netBucketSpend:ytdNetBucketSpend,bucketBalance:ytdBucketBalance},
    budget:{monthBudget,monthNetBucketSpend,monthBudgetVariance,plannedMonthly},
    projection:{remainingMonths,averageIncome,averageExpenses,futureIncomeAdjustment,futureExpenseAdjustment,projectedIncome,budgetGuidedExpenses,runRateExpenses,projectedExpenses,projectedNet,projectedSavingsRate,projectedAdjustedCash},
    buckets,categories,topExpenses,currentCards,cardsOwed,accounts,accountTotal,adjustedCash,unreconciled,unassignedTransactions,findings
  };
}

function reportClass(value,invert=false){
  const number=reportNumber(value);
  if(Math.abs(number)<.005)return'neutral';
  const good=invert?number<0:number>0;
  return good?'positive':'negative';
}

function reportMetric(label,value,detail='',className=''){
  return`<div class="metric ${className}"><div class="metric-label">${reportEscape(label)}</div><div class="metric-value">${reportEscape(value)}</div>${detail?`<div class="metric-detail">${reportEscape(detail)}</div>`:''}</div>`;
}

function renderMonthEndReport(analysis){
  const a=analysis;
  const categoryRows=a.categories.map(row=>`<tr><td>${reportEscape(row.label)}</td><td class="num">${reportMoney(row.monthBudget)}</td><td class="num">${reportMoney(row.monthSpent)}</td><td class="num ${reportClass(row.monthVariance)}">${reportMoney(row.monthVariance,true)}</td><td class="num">${reportMoney(row.ytdBudget)}</td><td class="num">${reportMoney(row.ytdSpent)}</td><td class="num ${reportClass(row.ytdBalance)}">${reportMoney(row.ytdBalance,true)}</td></tr>`).join('');
  const bucketRows=a.buckets.map(row=>`<tr><td>${reportEscape(row.name)}<small>${reportEscape(REPORT_TYPES[row.type]||row.type)}</small></td><td class="num">${reportMoney(row.monthBudget)}</td><td class="num">${reportMoney(row.monthSpent)}</td><td class="num ${reportClass(row.monthVariance)}">${reportMoney(row.monthVariance,true)}</td><td class="num ${reportClass(row.ytdBalance)}">${reportMoney(row.ytdBalance,true)}</td><td class="num ${reportClass(row.projectedBalance)}">${reportMoney(row.projectedBalance,true)}</td></tr>`).join('');
  const monthlyRows=a.monthly.map(row=>`<tr${row.month===a.month?' class="current"':''}><td>${REPORT_MONTHS[row.month-1]}</td><td class="num">${reportMoney(row.paycheckIncome)}</td><td class="num">${reportMoney(row.otherIncome)}</td><td class="num">${reportMoney(row.income)}</td><td class="num">${reportMoney(row.expenses)}</td><td class="num ${reportClass(row.net)}">${reportMoney(row.net,true)}</td></tr>`).join('');
  const expenseRows=a.topExpenses.map(row=>`<tr><td>${reportEscape(row.date)}</td><td>${reportEscape(row.description)}</td><td>${reportEscape(row.bucket)}</td><td>${reportEscape(row.who||'—')}</td><td>${reportEscape(row.card||'—')}</td><td class="num">${reportMoney(row.amount)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No expenses recorded for this month.</td></tr>';
  const accountRows=a.accounts.map(row=>`<tr><td>${reportEscape(row.name)}</td><td>${reportEscape(row.fund||'—')}</td><td class="num">${reportMoney(row.balance)}</td><td class="num">${reportMoney(row.buffer)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No accounts configured.</td></tr>';
  const cardRows=a.currentCards.map(row=>`<tr><td>${reportEscape(row.label)}</td><td class="num ${reportClass(-row.amount)}">${reportMoney(row.amount)}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">No tracked card balance through this report period.</td></tr>';
  const status=a.isPartial?'<span class="status warning">Partial month</span>':'<span class="status">Month-end</span>';
  const notes=a.notes?`<section><h2>Projection notes</h2><div class="notes">${reportEscape(a.notes)}</div></section>`:'';
  const projectedCash=a.projection.projectedAdjustedCash==null?'':reportMetric('Projected adjusted cash',reportMoney(a.projection.projectedAdjustedCash,true),'Current accounts less cards, plus forecast remaining cash flow',reportClass(a.projection.projectedAdjustedCash));
  return`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BudgetLock Analysis — ${reportEscape(a.monthName)} ${a.year}</title>
<style>
:root{--navy:#0f172a;--ink:#172033;--muted:#64748b;--line:#dbe3ee;--paper:#fff;--bg:#edf2f7;--green:#047857;--red:#b91c1c;--amber:#b45309;--blue:#4338ca}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.45}.report{max-width:1120px;margin:28px auto;background:var(--paper);box-shadow:0 18px 60px rgba(15,23,42,.12)}header{background:linear-gradient(135deg,#0f172a,#312e81);color:white;padding:34px 40px}header h1{font-size:28px;margin:5px 0 4px}header p{margin:0;color:#cbd5e1}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.13em;font-weight:800;color:#a5b4fc}.status{display:inline-block;border-radius:20px;background:#d1fae5;color:#065f46;font-size:11px;font-weight:800;padding:4px 10px;margin-top:14px}.status.warning{background:#fef3c7;color:#92400e}main{padding:30px 40px 42px}section{margin:0 0 30px;break-inside:avoid}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#475569;border-bottom:2px solid var(--line);padding-bottom:8px;margin:0 0 14px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metric{border:1px solid var(--line);border-radius:10px;padding:13px 14px;background:#fff}.metric-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800}.metric-value{font-size:23px;line-height:1.15;font-weight:800;margin-top:5px;font-variant-numeric:tabular-nums}.metric-detail{font-size:10px;color:var(--muted);margin-top:5px}.positive .metric-value,.positive{color:var(--green)}.negative .metric-value,.negative{color:var(--red)}.neutral{color:var(--muted)}.findings{margin:0;padding:0;list-style:none;display:grid;gap:8px}.findings li{border-left:4px solid #818cf8;background:#f8fafc;padding:9px 12px}table{border-collapse:collapse;width:100%;font-size:12px}th{background:#f1f5f9;color:#475569;text-align:left;text-transform:uppercase;letter-spacing:.045em;font-size:9px}th,td{padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top}tr.current td{background:#eef2ff}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td small{display:block;color:var(--muted);font-size:9px;margin-top:2px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}.callout{border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px;padding:13px 15px;color:#3730a3}.callout strong{display:block;margin-bottom:3px}.method{font-size:11px;color:var(--muted);line-height:1.55}.notes{white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:12px;background:#f8fafc}.empty{text-align:center;color:var(--muted);padding:20px}.footer{font-size:10px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;padding:8px 14px;background:rgba(15,23,42,.95)}.toolbar button{background:#4f46e5;color:#fff;border:0;border-radius:6px;padding:7px 13px;font:600 12px inherit;cursor:pointer}@media(max-width:760px){.report{margin:0;box-shadow:none}header,main{padding:24px 18px}.metrics{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}section{overflow-x:auto}}@media print{body{background:#fff;font-size:10px}.report{margin:0;max-width:none;box-shadow:none}.toolbar{display:none}header{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:22px 28px}main{padding:20px 28px}.metrics{grid-template-columns:repeat(4,1fr)}.metric{break-inside:avoid}.metric-value{font-size:17px}section{break-inside:auto}table{break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}}
</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div><article class="report"><header><div class="eyebrow">BudgetLock month-end analysis</div><h1>${reportEscape(a.monthName)} ${a.year}</h1><p>Generated ${new Date(a.generatedAt).toLocaleString('en-US')}</p>${status}</header><main>
<section><h2>Executive summary</h2><div class="metrics">${reportMetric('Month income',reportMoney(a.current.income),'Paychecks and recorded credits')}${reportMetric('Month expenses',reportMoney(a.current.expenses),'Cash spending; card payments excluded')}${reportMetric('Month cash flow',reportMoney(a.current.net,true),'Income less expenses',reportClass(a.current.net))}${reportMetric('Month budget variance',reportMoney(a.budget.monthBudgetVariance,true),'Funded buckets less net bucket spending',reportClass(a.budget.monthBudgetVariance))}${reportMetric('YTD income',reportMoney(a.ytd.income))}${reportMetric('YTD expenses',reportMoney(a.ytd.expenses))}${reportMetric('YTD cash flow',reportMoney(a.ytd.net,true),`Savings rate ${reportPercent(a.ytd.savingsRate)}`,reportClass(a.ytd.net))}${reportMetric('YTD bucket balance',reportMoney(a.ytd.bucketBalance,true),'Accrued funding plus allocations less net spending',reportClass(a.ytd.bucketBalance))}</div></section>
<section><h2>What stands out</h2><ul class="findings">${a.findings.map(finding=>`<li>${reportEscape(finding)}</li>`).join('')}</ul></section>
<section><h2>Year-end projection</h2><div class="metrics">${reportMetric('Projected income',reportMoney(a.projection.projectedIncome),`${a.projection.remainingMonths} month(s) remaining`)}${reportMetric('Budget-guided expenses',reportMoney(a.projection.budgetGuidedExpenses),'Actual YTD + remaining monthly budget')}${reportMetric('Run-rate expenses',reportMoney(a.projection.runRateExpenses),'YTD average annualized')}${reportMetric('Conservative expenses',reportMoney(a.projection.projectedExpenses),'Higher of the two expense forecasts')}${reportMetric('Projected cash flow',reportMoney(a.projection.projectedNet,true),`Projected savings rate ${reportPercent(a.projection.projectedSavingsRate)}`,reportClass(a.projection.projectedNet))}${reportMetric('Future income adjustment',reportMoney(a.projection.futureIncomeAdjustment,true),'One-time amount supplied for this report',reportClass(a.projection.futureIncomeAdjustment))}${reportMetric('Future expense adjustment',reportMoney(-a.projection.futureExpenseAdjustment,true),'One-time amount supplied for this report',reportClass(-a.projection.futureExpenseAdjustment))}${projectedCash}</div><div class="callout" style="margin-top:12px"><strong>Forecast approach</strong>Income continues at the YTD monthly average. Expenses use the more cautious of remaining funded budget and the annualized spending pace, then apply the one-time adjustments supplied at export.</div></section>
${notes}
<section><h2>Monthly cash flow</h2><table><thead><tr><th>Month</th><th class="num">Paychecks / other deposits</th><th class="num">Transaction credits</th><th class="num">Total income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead><tbody>${monthlyRows}</tbody><tfoot><tr><th>YTD</th><th></th><th></th><th class="num">${reportMoney(a.ytd.income)}</th><th class="num">${reportMoney(a.ytd.expenses)}</th><th class="num ${reportClass(a.ytd.net)}">${reportMoney(a.ytd.net,true)}</th></tr></tfoot></table></section>
<section><h2>Budget performance by category</h2><table><thead><tr><th>Category</th><th class="num">Month funded</th><th class="num">Month spent</th><th class="num">Month variance</th><th class="num">YTD funded</th><th class="num">YTD spent</th><th class="num">Envelope balance</th></tr></thead><tbody>${categoryRows}</tbody></table></section>
<section><h2>Bucket detail and projected year-end balance</h2><table><thead><tr><th>Bucket</th><th class="num">Month funded</th><th class="num">Month spent</th><th class="num">Month variance</th><th class="num">YTD balance</th><th class="num">Projected Dec. 31 balance</th></tr></thead><tbody>${bucketRows||'<tr><td colspan="6" class="empty">No buckets configured.</td></tr>'}</tbody></table><p class="method">Projected bucket balances annualize each bucket's YTD net spending and compare it with twelve months of base funding plus extra allocations already recorded. Future unrecorded allocations are not assumed.</p></section>
<section><h2>Largest expenses this month</h2><table><thead><tr><th>Date</th><th>Description</th><th>Bucket</th><th>Who</th><th>Card</th><th class="num">Amount</th></tr></thead><tbody>${expenseRows}</tbody></table></section>
<section class="grid2"><div><h2>Current account snapshot</h2><table><thead><tr><th>Account</th><th>Fund</th><th class="num">Balance</th><th class="num">Buffer</th></tr></thead><tbody>${accountRows}</tbody><tfoot><tr><th colspan="2">Current total</th><th class="num">${reportMoney(a.accountTotal)}</th><th></th></tr></tfoot></table><p class="method">Account balances are today's manually synced balances, not reconstructed historical month-end balances. Adjusted cash after tracked card obligations: <strong>${reportMoney(a.adjustedCash,true)}</strong>.</p></div><div><h2>Tracked cards through report period</h2><table><thead><tr><th>Card</th><th class="num">Outstanding</th></tr></thead><tbody>${cardRows}</tbody><tfoot><tr><th>Total${a.cardsOwed!==a.currentCards.reduce((sum,card)=>sum+card.amount,0)?' incl. pending Amex':''}</th><th class="num">${reportMoney(a.cardsOwed)}</th></tr></tfoot></table></div></section>
<section><h2>Data checks</h2><div class="metrics">${reportMetric('Unreconciled pay',reportMoney(a.unreconciled.total),`${reportMoney(a.unreconciled.over)} over · ${reportMoney(a.unreconciled.under)} short`,a.unreconciled.total>.01?'negative':'positive')}${reportMetric('Unassigned transactions',String(a.unassignedTransactions),'Transactions without a matching bucket',a.unassignedTransactions?'negative':'positive')}${reportMetric('Accounts less cards',reportMoney(a.adjustedCash,true),'Current bank balances less tracked card obligations',reportClass(a.adjustedCash))}${reportMetric('Report status',a.isPartial?'Partial month':'Completed period',a.isCurrentLedger?'Matches the app active period':'Historical report period',a.isPartial?'negative':'positive')}</div></section>
<section><h2>Definitions and cautions</h2><p class="method"><strong>Income</strong> includes logged paychecks, other deposits, and transactions recorded as income/refunds. <strong>Expenses</strong> include expense transactions; credit-card payments are transfers and are excluded to avoid double counting. <strong>Funded</strong> means the month's base bucket amount plus extra allocations, while <strong>envelope balance</strong> carries all funding and net spending through the selected month. Projections are planning estimates, not guarantees, and become more reliable as more complete months are recorded.</p></section>
<div class="footer">BudgetLock · ${reportEscape(a.monthName)} ${a.year} month-end analysis · Generated from locally stored app data.</div>
</main></article></body></html>`;
}

function monthEndExportCard(){
  return`<div class="card"><div class="card-hdr"><h2>${ico('trendingUp',14)} Month-End Analysis</h2></div>
    <p style="margin-bottom:13px;font-size:.86rem;color:var(--muted)">Export a detailed, printable HTML report with monthly and YTD cash flow, bucket performance, major expenses, data checks, and conservative year-end projections. Known future one-time items can be added before export.</p>
    <button class="btn btn-primary" onclick="openMonthEndReport()">${ico('trendingUp',13)} Build Month-End Report</button>
  </div>`;
}

function openMonthEndReport(){
  const configuredYear=typeof cyr==='function'?cyr():new Date().getFullYear();
  const configuredMonth=typeof cmo==='function'?cmo():new Date().getMonth()+1;
  const monthOptions=REPORT_MONTHS.map((name,index)=>`<option value="${index+1}"${index+1===configuredMonth?' selected':''}>${name}</option>`).join('');
  openModal(`<div class="mhdr"><h3>Export Month-End Analysis</h3><button class="mclose" onclick="closeModal()">${ico('x',15)}</button></div>
    <div class="mbody">
      <p class="c-muted" style="font-size:.8rem;margin-bottom:14px">Choose the month being closed. Optional adjustments should include only future one-time amounts not already captured by the normal YTD run rate or monthly bucket plan.</p>
      <div class="frow">
        <div class="fg"><label>Report month</label><select id="mer-month">${monthOptions}</select></div>
        <div class="fg"><label>Report year</label><input type="number" id="mer-year" min="2000" max="2200" value="${configuredYear}"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>Future one-time income</label><input type="number" id="mer-income" step="0.01" min="0" value="0" placeholder="Car sale, bonus, extra pay…"><div class="c-muted" style="font-size:.7rem;margin-top:3px">Added to projected income after the report month</div></div>
        <div class="fg"><label>Future one-time expenses</label><input type="number" id="mer-expense" step="0.01" min="0" value="0" placeholder="Travel, closing costs…"><div class="c-muted" style="font-size:.7rem;margin-top:3px">Added to projected expenses after the report month</div></div>
      </div>
      <div class="fg"><label>Projection notes / assumptions</label><textarea id="mer-notes" rows="4" placeholder="Example: $2,500 car sale; $1,800 Disney; $5,000 car closing. Only amounts entered above change the calculation."></textarea></div>
      <div class="alert al-warn" style="font-size:.76rem">${ico('alertTriangle',14)} <div>The report treats funded buckets as envelopes and does not mistake already-funded money for new cash. Credit-card payments are excluded from expenses to prevent double counting.</div></div>
    </div>
    <div class="mfoot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="exportMonthEndAnalysis()">Export HTML Report</button></div>`);
}

function exportMonthEndAnalysis(){
  const year=Number(document.getElementById('mer-year')?.value);
  const month=Number(document.getElementById('mer-month')?.value);
  const futureIncomeAdjustment=Number(document.getElementById('mer-income')?.value)||0;
  const futureExpenseAdjustment=Number(document.getElementById('mer-expense')?.value)||0;
  const notes=document.getElementById('mer-notes')?.value||'';
  if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12){alert('Choose a valid report month and year.');return;}
  if(futureIncomeAdjustment<0||futureExpenseAdjustment<0){alert('Future one-time income and expenses must be zero or positive.');return;}
  const analysis=buildMonthEndAnalysis(db,year,month,{futureIncomeAdjustment,futureExpenseAdjustment,notes});
  const html=renderMonthEndReport(analysis);
  dlFile(`budget_analysis_${year}-${String(month).padStart(2,'0')}.html`,html,'text/html;charset=utf-8');
  closeModal();
}

if(typeof module!=='undefined'&&module.exports){module.exports={buildMonthEndAnalysis,renderMonthEndReport,reportCashForMonth,reportBucketSpend};}
