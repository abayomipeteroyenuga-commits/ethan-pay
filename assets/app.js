const $=s=>document.querySelector(s), modal=$("#modal"), body=$("#modalBody");
const records=JSON.parse(localStorage.getItem("ethanPayRecords")||"[]");
function ref(){return "ETH-"+new Date().getFullYear()+"-"+Math.random().toString(36).slice(2,8).toUpperCase()}
function save(){localStorage.setItem("ethanPayRecords",JSON.stringify(records));render()}
function render(){const h=$("#history"),e=$("#empty");h.innerHTML="";e.style.display=records.length?"none":"block";records.slice().reverse().forEach(r=>{h.innerHTML+=`<tr><td><b>${r.ref}</b></td><td>${r.service}</td><td>${r.currency} ${Number(r.amount).toLocaleString()}</td><td>${r.date}</td><td><span class="pill">${r.status}</span></td></tr>`})}
function open(type){
 modal.classList.add("show");modal.setAttribute("aria-hidden","false");
 if(type==="pay") body.innerHTML=`<h2>Make a payment</h2><p class="notice">Gateway processing is intentionally disabled in v1. This form creates a payment reference only.</p><div class="formrow"><label>Service</label><input id="mservice" value="${$("#service").value}"></div><div class="formrow"><label>Amount</label><input id="mamount" type="number" min="1" value="${$("#amount").value}"></div><div class="formrow"><label>Currency</label><select id="mcurrency"><option>NGN</option><option>USD</option><option>GBP</option><option>EUR</option></select></div><button class="primary wide" id="createRef">Create payment reference</button>`;
 if(type==="bank") body.innerHTML=`<h2>Submit bank payment</h2><p class="notice">This preview stores the submission on this device only. Cloud upload and administrator approval will be connected later.</p><label>Amount paid</label><input id="bankAmount" type="number" min="1"><label>Bank / transfer reference</label><input id="bankRef" placeholder="Enter transaction reference"><button class="primary wide" id="submitBank">Submit for review</button>`;
 if(type==="verify") body.innerHTML=`<h2>Verify payment reference</h2><label>Ethan Pay reference</label><input id="verifyRef" placeholder="ETH-2026-XXXXXX"><button class="primary wide" id="checkRef">Check reference</button><div id="verifyResult"></div>`;
 if(type==="signin") body.innerHTML=`<h2>Ethan ID sign in</h2><p class="notice">Ethan ID will be connected during the ecosystem integration phase. No separate Ethan Pay password is created in this preview.</p><button class="secondary wide" id="dismiss">Close</button>`;
}
document.addEventListener("click",e=>{
 const o=e.target.closest("[data-open]");if(o)open(o.dataset.open);
 const s=e.target.closest("[data-service]");if(s){$("#service").value=s.dataset.service;open("pay")}
 if(e.target.id==="createRef"){let a=Number($("#mamount").value);if(!a)return alert("Enter an amount.");let r={ref:ref(),service:$("#mservice").value,amount:a,currency:$("#mcurrency").value,date:new Date().toLocaleDateString(),status:"AWAITING GATEWAY"};records.push(r);save();body.innerHTML=`<h2>Reference created</h2><div class="success">${r.ref}</div><p>This is a preview reference. No money has been charged.</p>`}
 if(e.target.id==="submitBank"){let a=Number($("#bankAmount").value),b=$("#bankRef").value.trim();if(!a||!b)return alert("Complete the amount and transfer reference.");let r={ref:ref(),service:"Bank Payment Submission",amount:a,currency:"NGN",date:new Date().toLocaleDateString(),status:"PENDING REVIEW"};records.push(r);save();body.innerHTML=`<h2>Submission recorded</h2><div class="success">${r.ref}</div><p>Preview only: this record is stored on this device until the backend is connected.</p>`}
 if(e.target.id==="checkRef"){let q=$("#verifyRef").value.trim().toUpperCase(),r=records.find(x=>x.ref===q);$("#verifyResult").innerHTML=r?`<div class="success" style="margin-top:14px">${r.ref} — ${r.status}</div>`:`<div class="notice">No local preview record found for that reference.</div>`}
 if(e.target.id==="dismiss")close()
});
function close(){modal.classList.remove("show");modal.setAttribute("aria-hidden","true")}
$("#close").onclick=close;modal.addEventListener("click",e=>{if(e.target===modal)close()});render();