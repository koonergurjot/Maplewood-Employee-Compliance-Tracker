function startTour(){
  const steps = [
    { element: '#import-btn', text: 'Import employee data from a file.' },
    { element: '#export-btn', text: 'Export current data in multiple formats.' },
    { element: '#settings-btn', text: 'Configure requirements and app preferences.' },
    { element: '#employee-table', text: 'Track employee compliance statuses here.' },
    { element: '#admin-panel', text: 'Use the Admin Panel to manage employees and requirements.' }
  ];
  let index = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  const text = document.createElement('div');
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-primary';
  nextBtn.textContent = 'Next';
  nextBtn.style.marginTop = '0.5rem';
  tooltip.appendChild(text);
  tooltip.appendChild(nextBtn);
  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);

  function showStep(){
    if(index >= steps.length){
      cleanup();
      return;
    }
    const step = steps[index];
    const el = document.querySelector(step.element);
    if(!el){
      index++;
      showStep();
      return;
    }
    document.querySelectorAll('.tour-highlight').forEach(e=>e.classList.remove('tour-highlight'));
    el.classList.add('tour-highlight');
    el.scrollIntoView({behavior:'smooth', block:'center'});
    const rect = el.getBoundingClientRect();
    text.textContent = step.text;
    tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    nextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
  }

  function next(){
    index++;
    showStep();
  }

  function cleanup(){
    document.querySelectorAll('.tour-highlight').forEach(e=>e.classList.remove('tour-highlight'));
    overlay.remove();
    tooltip.remove();
  }

  nextBtn.addEventListener('click', next);
  overlay.addEventListener('click', cleanup);
  showStep();
}

window.startTour = startTour;
