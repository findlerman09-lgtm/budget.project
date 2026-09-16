'use strict';

/* Optional planning and month-close layer. Nothing in this file changes the
   transaction-entry, balance, bucket-accrual, or paycheck-holding workflows. */

let _editPlanEventId=null;

function planEvents(){return Array.isArray(db.plannedEvents)?db.plannedEvents:[];}
function planClosures(){return Array.isArray(db.monthClosures)?db.monthClosures:[];}

function planEventEffect(event){return event.affectsProjection===false?'Reference only':'Included';}

function planForecastSource(schedule){
  if(!schedule.available)return'Set a next date';
  if(schedule.source==='configured')return'Saved schedule';
  if(schedule.source==='inferred')return'Inferred from paycheck history';
  return'Last paycheck + 14 days';
}

function planningCard(){
  const year=cyr(),month=cmo(),forecast=reportPaycheckForecast(db,year,month);
  const forecastRows=forecast.schedules.map(schedule=>`<tr>
    <td><strong>${esc(schedule.who)}</strong><div class="c-muted" style="font-size:.68rem">${esc(planForecastSource(schedule))} · every ${schedule.cadenceDays} days</div></td>
    <td style="text-align:right">${schedule.available?schedule.count:'—'}</td>
    <td style="text-align:right">${schedule.available?$f(schedule.total):'—'}</td>
    <td class="c-muted" style="font-size:.72rem">${schedule.dates.length?esc(schedule.dates.slice(0,4).map(fdate).join(' · '))+(schedule.dates.length>4?` · +${schedule.dates.length-4} more`:''):'No schedule available'}</td>
  </tr>`).join('');
  const eventRows=[...planEvents()].sort((a,b)=>(a.status==='completed')-(b.status==='completed')||String(a.date).localeCompare(String(b.date))).map(event=>`<tr${event.status==='completed'?' style="opacity:.58"':''}>
    <td style="white-space:nowrap">${fdate(event.date)}</td>
    <td><strong>${esc(event.name)}</strong>${event.notes?`<div class="c-muted" style="font-size:.68rem">${esc(event.notes)}</div>`:''}</td>
    <td><span class="badge ${event.type==='income'?'badge-green':'badge-red'}">${event.type==='income'?'Income':'Expense'}</span></td>
    <td style="text-align:right" class="${event.type==='income'?'c-green':'c-red'}">${event.type==='income'?'+':'−'}${$f(event.amount)}</td>
    <td>${event.bucket?esc(bname(event.bucket)):'—'}<div class="c-muted" style="font-size:.66rem">${planEventEffect(event)}</div></td>
    <td style="white-space:nowrap"><button class="btn btn-ghost btn-xs" onclick="togglePlanEvent('${event.id}')">${event.status==='completed'?'Restore':'Complete'}</button> <button class="btn btn-ghost btn-xs" onclick="openEditPlanEvent('${event.id}')">Edit</button> <button class="btn btn-danger btn-xs" onclick="deletePlanEvent('${event.id}')">Del</button></td>
  </tr>`).join('');
  const closureRows=[...planClosures()].sort((a,b)=>b.year-a.year||b.month-a.month).map(closure=>`<div class="setup-brow">
    <span style="flex:1"><strong>${REPORT_MONTHS[closure.month-1]} ${closure.year}</strong><div class="c-muted" style="font-size:.68rem">Snapshot ${new Date(closure.closedAt).toLocaleString('en-US')}</div></span>
    <span style="font-size:.76rem;margin-right:8px" class="${closure.analysis?.projection?.projectedNet>=0?'c-green':'c-red'}">EOY ${$s(closure.analysis?.projection?.projectedNet||0)}</span>
    <button class="btn btn-ghost btn-xs" onclick="exportClosedMonth('${closure.id}')">Export</button>
    <button class="btn btn-danger btn-xs" onclick="removeMonthClose('${closure.id}')">Remove</button>
  </div>`).join('');
  const included=planEvents().filter(event=>event.status!=='completed'&&event.affectsProjection!==false).length;
  return`<div class="card"><div class="card-hdr"><h2>${ico('trendingUp',14)} Planning & Month Close</h2><span class="c-muted" style="font-size:.72rem">Optional — daily entry is unchanged</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primary" onclick="openMonthClose()">${ico('archive',13)} Close & Snapshot ${MO[month-1]}</button>
      <button class="btn btn-ghost" onclick="openAddPlanEvent()">+ Future Event</button>
      <button class="btn btn-ghost" onclick="openPayForecastSettings()">Paycheck Forecast Settings</button>
    </div>
    <p class="c-muted" style="font-size:.78rem;margin-bottom:13px">Closing creates a report snapshot only. It does not lock transactions, change balances, or move the active month unless you explicitly choose to advance it.</p>
    <div class="sum-row">
      <div class="sum-tile"><div class="sum-lbl">Remaining Regular Checks</div><div class="sum-val">${forecast.complete?forecast.count:'—'}</div><div class="c-muted" style="font-size:.7rem;margin-top:3px">${forecast.complete?$f(forecast.total)+' projected':'schedule needs attention'}</div></div>
      <div class="sum-tile"><div class="sum-lbl">Future Events</div><div class="sum-val">${included}</div><div class="c-muted" style="font-size:.7rem;margin-top:3px">included in projections</div></div>
      <div class="sum-tile"><div class="sum-lbl">Month Snapshots</div><div class="sum-val">${planClosures().length}</div><div class="c-muted" style="font-size:.7rem;margin-top:3px">historical reports preserved</div></div>
    </div>
    <details open><summary style="cursor:pointer;font-weight:700;font-size:.82rem;margin:4px 0 9px">Remaining paycheck forecast</summary>
      ${forecastRows?`<div class="tbl-wrap"><table class="dt"><thead><tr><th>Person</th><th style="text-align:right">Checks</th><th style="text-align:right">Total</th><th>Expected dates</th></tr></thead><tbody>${forecastRows}</tbody></table></div>`:'<div class="empty-state">Enter paycheck amounts in Setup to enable the forecast.</div>'}
    </details>
    <details${eventRows?' open':''}><summary style="cursor:pointer;font-weight:700;font-size:.82rem;margin:13px 0 9px">Future events (${planEvents().length})</summary>
      ${eventRows?`<div class="tbl-wrap"><table class="dt"><thead><tr><th>Date</th><th>Item</th><th>Type</th><th style="text-align:right">Amount</th><th>Bucket / Treatment</th><th></th></tr></thead><tbody>${eventRows}</tbody></table></div>`:'<div class="empty-state">No future events saved. Add known items such as a car sale, travel, or closing costs.</div>'}
    </details>
    <details${closureRows?' open':''}><summary style="cursor:pointer;font-weight:700;font-size:.82rem;margin:13px 0 9px">Saved month-end snapshots (${planClosures().length})</summary>
      ${closureRows||'<div class="empty-state">No month has been snapshotted yet.</div>'}
    </details>
  </div>`;
}

function openAddPlanEvent(){
  _editPlanEventId=null;
  showPlanEventModal({date:today(),name:'',type:'expense',amount:'',bucket:'',notes:'',status:'planned',affectsProjection:true},'Add Future Event');
}

function openEditPlanEvent(id){
  const event=planEvents().find(item=>item.id===id);if(!event)return;
  _editPlanEventId=id;showPlanEventModal({...event},'Edit Future Event');
}

function showPlanEventModal(event,title){
  const bucketOptions='<option value="">— none —</option>'+db.buckets.map(bucket=>`<option value="${bucket.id}"${event.bucket===bucket.id?' selected':''}>${esc(bucket.name)}</option>`).join('');
  openModal(`<div class="mhdr"><h3>${esc(title)}</h3><button class="mclose" onclick="closeModal()">${ico('x',15)}</button></div>
    <div class="mbody">
      <p class="c-muted" style="font-size:.78rem;margin-bottom:12px">Future events affect projections only. Completing one does not create a transaction or change an account balance.</p>
      <div class="frow"><div class="fg"><label>Date</label><input type="date" id="pe-date" value="${esc(event.date)}"></div><div class="fg"><label>Type</label><select id="pe-type"><option value="income"${event.type==='income'?' selected':''}>Income</option><option value="expense"${event.type!=='income'?' selected':''}>Expense</option></select></div></div>
      <div class="fg"><label>Description</label><input type="text" id="pe-name" value="${esc(event.name)}" placeholder="Car sale, Disney, vehicle closing…"></div>
      <div class="frow"><div class="fg"><label>Amount</label><input type="number" min="0" step="0.01" id="pe-amount" value="${event.amount}"></div><div class="fg"><label>Bucket (optional)</label><select id="pe-bucket">${bucketOptions}</select></div></div>
      <div class="frow"><div class="fg"><label>Projection treatment</label><select id="pe-affects"><option value="yes"${event.affectsProjection!==false?' selected':''}>Add beyond normal forecast</option><option value="no"${event.affectsProjection===false?' selected':''}>Reference only</option></select></div><div class="fg"><label>Status</label><select id="pe-status"><option value="planned"${event.status!=='completed'?' selected':''}>Planned</option><option value="completed"${event.status==='completed'?' selected':''}>Completed</option></select></div></div>
      <div class="fg"><label>Notes</label><textarea id="pe-notes" rows="3">${esc(event.notes||'')}</textarea></div>
    </div><div class="mfoot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePlanEvent()">Save Event</button></div>`);
}

function savePlanEvent(){
  const event={id:_editPlanEventId||uid(),date:document.getElementById('pe-date').value,name:document.getElementById('pe-name').value.trim(),type:document.getElementById('pe-type').value,amount:parseFloat(document.getElementById('pe-amount').value)||0,bucket:document.getElementById('pe-bucket').value,affectsProjection:document.getElementById('pe-affects').value==='yes',status:document.getElementById('pe-status').value,notes:document.getElementById('pe-notes').value.trim()};
  if(!event.date||!event.name||event.amount<=0){alert('Enter a date, description, and positive amount.');return;}
  if(!dateSane(event.date))return;
  if(!Array.isArray(db.plannedEvents))db.plannedEvents=[];
  const index=db.plannedEvents.findIndex(item=>item.id===event.id);
  if(index>=0)db.plannedEvents[index]=event;else db.plannedEvents.push(event);
  dbSave();closeModal();pageR();
}

function togglePlanEvent(id){
  const event=planEvents().find(item=>item.id===id);if(!event)return;
  const completing=event.status!=='completed';
  if(completing&&!confirm(`Mark "${event.name}" completed?\n\nIt will stop affecting projections. No transaction or account balance will be created or changed.`))return;
  event.status=completing?'completed':'planned';
  if(completing)event.completedAt=new Date().toISOString();else delete event.completedAt;
  dbSave();pageR();
}

function deletePlanEvent(id){
  const event=planEvents().find(item=>item.id===id);if(!event)return;
  if(!confirm(`Delete the future event "${event.name}"?\nThis does not affect any transaction or balance.`))return;
  db.plannedEvents=planEvents().filter(item=>item.id!==id);dbSave();pageR();
}

function openPayForecastSettings(){
  const settings=db.cfg.payForecast||{},forecast=reportPaycheckForecast(db,cyr(),cmo());
  const fields=['Chris','Sarah'].map(who=>{
    const saved=settings[who]||{},detected=forecast.schedules.find(item=>item.who===who),cadence=saved.cadenceDays||detected?.cadenceDays||14;
    return`<div class="card" style="box-shadow:none;border:1px solid var(--border)"><div style="font-weight:700;margin-bottom:10px">${who}</div><div class="frow"><div class="fg"><label>Next expected paycheck (optional)</label><input type="date" id="pfs-${who}-date" value="${esc(saved.nextDate||'')}"><div class="c-muted" style="font-size:.68rem;margin-top:3px">Leave blank to infer from paycheck history</div></div><div class="fg"><label>Days between checks</label><input type="number" min="7" max="35" step="1" id="pfs-${who}-days" value="${cadence}"></div></div></div>`;
  }).join('');
  openModal(`<div class="mhdr"><h3>Paycheck Forecast Settings</h3><button class="mclose" onclick="closeModal()">${ico('x',15)}</button></div><div class="mbody"><p class="c-muted" style="font-size:.78rem;margin-bottom:12px">These settings affect projections only. They do not create paychecks, deposits, holds, or bucket allocations.</p>${fields}</div><div class="mfoot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePayForecastSettings()">Save Forecast Settings</button></div>`);
}

function savePayForecastSettings(){
  const next={};
  for(const who of['Chris','Sarah']){
    const nextDate=document.getElementById(`pfs-${who}-date`).value;
    const cadenceDays=Math.round(parseFloat(document.getElementById(`pfs-${who}-days`).value)||14);
    if(cadenceDays<7||cadenceDays>35){alert('Days between checks must be between 7 and 35.');return;}
    next[who]={cadenceDays};if(nextDate)next[who].nextDate=nextDate;
  }
  db.cfg.payForecast=next;dbSave();closeModal();pageR();
}

function planCloseWarnings(year,month,analysis){
  const overdue=planEvents().filter(event=>event.status!=='completed'&&reportThroughMonth(event.date,year,month));
  const negative=analysis.buckets.filter(bucket=>bucket.ytdBalance<-.005);
  const warnings=[];
  if(analysis.isPartial)warnings.push('This calendar month is still in progress; the snapshot will be marked partial.');
  if(analysis.unreconciled.total>.01)warnings.push(`${$f(analysis.unreconciled.total)} of paycheck differences remains unreconciled.`);
  if(analysis.unassignedTransactions)warnings.push(`${analysis.unassignedTransactions} transaction${analysis.unassignedTransactions===1?' has':'s have'} no matching bucket.`);
  if(overdue.length)warnings.push(`${overdue.length} planned event${overdue.length===1?' is':'s are'} dated within or before this month but still marked planned.`);
  if(negative.length)warnings.push(`${negative.length} bucket${negative.length===1?' has':'s have'} a negative YTD envelope balance.`);
  return warnings;
}

function openMonthClose(){
  const year=cyr(),month=cmo();
  if(planClosures().some(item=>item.year===year&&item.month===month)){alert(`${MO[month-1]} ${year} already has a saved snapshot. Remove that snapshot first if you need to close it again.`);return;}
  const analysis=buildMonthEndAnalysis(db,year,month),warnings=planCloseWarnings(year,month,analysis);
  openModal(`<div class="mhdr"><h3>Close & Snapshot ${MO[month-1]} ${year}</h3><button class="mclose" onclick="closeModal()">${ico('x',15)}</button></div><div class="mbody">
    <p class="c-muted" style="font-size:.8rem;margin-bottom:12px">This saves the current report values for historical reference. It does not lock or modify live budget data.</p>
    ${warnings.length?`<div class="alert al-warn" style="margin-bottom:12px">${ico('alertTriangle',14)}<div>${warnings.map(warning=>`<div>• ${esc(warning)}</div>`).join('')}</div></div>`:`<div class="alert" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;margin-bottom:12px">${ico('check',14)} <div>No automatic data warnings found.</div></div>`}
    <div class="sum-row"><div class="sum-tile"><div class="sum-lbl">Accounts</div><div class="sum-val">${$s(analysis.accountTotal)}</div></div><div class="sum-tile"><div class="sum-lbl">Cards Owed</div><div class="sum-val">${$f(analysis.cardsOwed)}</div></div><div class="sum-tile"><div class="sum-lbl">YTD Cash Flow</div><div class="sum-val ${analysis.ytd.net>=0?'c-green':'c-red'}">${$s(analysis.ytd.net)}</div></div><div class="sum-tile"><div class="sum-lbl">Projected EOY</div><div class="sum-val ${analysis.projection.projectedNet>=0?'c-green':'c-red'}">${$s(analysis.projection.projectedNet)}</div></div></div>
    <label style="display:flex;gap:9px;align-items:flex-start;margin:9px 0;font-size:.82rem"><input type="checkbox" id="mc-accounts" style="margin-top:3px"> <span>I have reviewed and updated the account balances I want captured.</span></label>
    <label style="display:flex;gap:9px;align-items:flex-start;margin:9px 0;font-size:.82rem"><input type="checkbox" id="mc-cards" style="margin-top:3px"> <span>I have reviewed card balances and pending card activity.</span></label>
    <label style="display:flex;gap:9px;align-items:flex-start;margin:9px 0;font-size:.82rem"><input type="checkbox" id="mc-events" style="margin-top:3px"> <span>I have reviewed future events and paycheck forecast assumptions.</span></label>
    ${month<12?`<label style="display:flex;gap:9px;align-items:flex-start;margin:14px 0 0;font-size:.82rem;padding-top:12px;border-top:1px solid var(--border)"><input type="checkbox" id="mc-advance" style="margin-top:3px"> <span><strong>After saving, advance the active month to ${MO[month]}.</strong><br><span class="c-muted">Unchecked by default. Existing data and balances are unchanged either way.</span></span></label>`:''}
  </div><div class="mfoot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveMonthClose(${year},${month})">Save Snapshot</button></div>`);
}

function saveMonthClose(year,month){
  if(!document.getElementById('mc-accounts').checked||!document.getElementById('mc-cards').checked||!document.getElementById('mc-events').checked){alert('Confirm all three review items before saving the snapshot.');return;}
  if(planClosures().some(item=>item.year===year&&item.month===month)){alert('A snapshot already exists for this month.');return;}
  const closedAt=new Date().toISOString(),analysis=buildMonthEndAnalysis(db,year,month);
  analysis.snapshotClosedAt=closedAt;
  if(!Array.isArray(db.monthClosures))db.monthClosures=[];
  db.monthClosures.push({id:uid(),version:1,year,month,closedAt,analysis});
  const advance=month<12&&document.getElementById('mc-advance')?.checked;
  if(advance)db.cfg.month=month+1;
  dbSave();closeModal();render();
  alert(`${MO[month-1]} ${year} snapshot saved.${advance?` The active month is now ${MO[month]}.`:''}`);
}

function exportClosedMonth(id){
  const closure=planClosures().find(item=>item.id===id);if(!closure?.analysis)return;
  dlFile(`budget_analysis_${closure.year}-${String(closure.month).padStart(2,'0')}_closed.html`,renderMonthEndReport(closure.analysis),'text/html;charset=utf-8');
}

function removeMonthClose(id){
  const closure=planClosures().find(item=>item.id===id);if(!closure)return;
  if(!confirm(`Remove the saved ${MO[closure.month-1]} ${closure.year} snapshot?\n\nLive transactions, buckets, balances, and the active month will not change.`))return;
  db.monthClosures=planClosures().filter(item=>item.id!==id);dbSave();pageR();
}

if(typeof module!=='undefined'&&module.exports){module.exports={planForecastSource,planEventEffect};}
