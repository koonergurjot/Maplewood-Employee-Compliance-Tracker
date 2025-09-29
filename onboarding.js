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
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '0.5rem';
  controls.style.marginTop = '0.75rem';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn btn-primary';
  nextBtn.textContent = 'Next';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'btn';
  skipBtn.textContent = 'Skip tour';
  skipBtn.style.background = 'var(--card)';
  skipBtn.style.borderColor = 'var(--line)';
  controls.appendChild(nextBtn);
  controls.appendChild(skipBtn);
  tooltip.appendChild(text);
  tooltip.appendChild(controls);
  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);

  window.dispatchEvent(new CustomEvent('tour:started'));

  let cleaning = false;

  function cleanup(reason='completed'){
    if(cleaning) return;
    cleaning = true;
    document.querySelectorAll('.tour-highlight').forEach(e=>e.classList.remove('tour-highlight'));
    overlay.remove();
    tooltip.remove();
    window.dispatchEvent(new CustomEvent('tour:ended', { detail: { reason } }));
  }

  function showStep(){
    if(index >= steps.length){
      cleanup('completed');
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

  nextBtn.addEventListener('click', next);
  skipBtn.addEventListener('click', () => cleanup('skipped'));
  overlay.addEventListener('click', () => cleanup('skipped'));
  showStep();
}

window.startTour = startTour;
