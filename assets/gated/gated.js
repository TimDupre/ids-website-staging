/* Gated downloads (PREVIEW): opens an email gate for any element with data-gate="<id>". Nothing is sent. */
(function(){
  var CATALOG={
    'es-deepfakes':{title:'Deepfakes',type:'Executive Summary'},
    'es-evidence-real':{title:'Is Your Evidence Real?',type:'Executive Summary'},
    'es-emerging-trends':{title:'Emerging Trends',type:'Executive Summary'},
    'es-in-the-shadows':{title:'In the Shadows',type:'Executive Summary'},
    'es-employees-rogue':{title:'Employees Going Rogue',type:'Executive Summary'},
    'es-ai-investigations':{title:'AI in Investigations',type:'Executive Summary'},
    'future-of-evidence':{title:'The Future of Evidence',type:'Download'},
    'testifying-expert-checklist':{title:'Testifying Expert Checklist',type:'Checklist'},
    'data-source-checklist':{title:'Data Source Evaluation Checklist',type:'Checklist'},
    'fact-crashing-ebook':{title:'Fact Crashing',type:'eBook'}
  };
  var PUCK='<svg viewBox="0 0 270 270" aria-hidden="true"><circle cx="135" cy="135" r="135" fill="#DB6015" mask="url(#puck-cut)"/></svg>';
  function cover(d){return '<div class="gd-cover"><span class="gd-type">'+d.type+'</span><span class="gd-title">'+d.title+'</span>'+PUCK+'</div>';}
  var m=document.createElement('div'); m.className='gd-modal'; m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true'); m.setAttribute('aria-label','Download');
  document.body.appendChild(m);
  var last=null;
  function open(id,trigger){
    var d=CATALOG[id]; if(!d) return; last=trigger;
    m.innerHTML='<div class="gd-box"><button type="button" class="gd-close" aria-label="Close">&times;</button>'+cover(d)+
      '<div class="gd-form"><div class="gd-ask"><h3>Get the '+d.type.toLowerCase().replace('download','download')+'</h3>'+
      '<p>Tell us where to send <strong>'+d.title+'</strong>. Your download opens right away.</p>'+
      '<form novalidate><label for="gd-n">Name</label><input id="gd-n" name="name" required autocomplete="name" />'+
      '<label for="gd-e">Work email</label><input id="gd-e" name="email" type="email" required autocomplete="email" />'+
      '<label for="gd-f">Firm or organization</label><input id="gd-f" name="firm" autocomplete="organization" />'+
      '<button class="gd-btn" type="submit">Get the download</button></form>'+
      '<div class="gd-note">Preview only: this form is not connected yet, and nothing is sent.</div></div>'+
      '<div class="gd-done"><h3>Thanks<span class="gd-who"></span>. Your download is ready.</h3><p>We have also sent a copy to your email.</p>'+
      '<a class="gd-btn" href="#" onclick="return false">Download PDF</a><div class="gd-note">Preview only: the PDF link goes here once files are confirmed.</div></div></div></div>';
    m.classList.add('open'); document.body.style.overflow='hidden';
    var f=m.querySelector('form'), box=m.querySelector('.gd-box');
    m.querySelector('#gd-n').focus();
    f.addEventListener('submit',function(e){ e.preventDefault(); var n=f.name.value.trim(), em=f.email.value.trim();
      if(!n||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ (n?f.email:f.name).focus(); (n?f.email:f.name).style.borderColor='#DB6015'; return; }
      m.querySelector('.gd-who').textContent=', '+n.split(' ')[0]; box.classList.add('sent'); });
    m.querySelector('.gd-close').addEventListener('click',close);
  }
  function close(){ m.classList.remove('open'); m.innerHTML=''; document.body.style.overflow=''; if(last) last.focus(); }
  m.addEventListener('click',function(e){ if(e.target===m) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&m.classList.contains('open')) close(); });
  document.addEventListener('click',function(e){ var t=e.target.closest('[data-gate]'); if(!t) return; e.preventDefault(); open(t.getAttribute('data-gate'),t); });
  window.iDSGated={catalog:CATALOG,cover:cover};
})();
