(function(){
  const storageKey = 'maplewood:theme';
  const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const applyTheme = (isDark) => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  };

  const initTheme = () => {
    try{
      const stored = window.localStorage.getItem(storageKey);
      if(stored === 'dark' || stored === 'light'){
        applyTheme(stored === 'dark');
        return;
      }
    }catch(error){
      // ignore storage errors and fallback to prefers-color-scheme
    }
    applyTheme(prefersDark());
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initTheme, { once: true });
  }else{
    initTheme();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-add-employee');
    const modal = document.getElementById('add-employee-modal');
    if(!btn || !modal){
      return;
    }

    const open = (event) => {
      if(event){
        event.preventDefault();
      }
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    };

    const close = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    btn.addEventListener('click', open);
    modal.addEventListener('click', (event) => {
      if(event.target === modal){
        close();
      }
    });

    modal.querySelectorAll('[data-close]').forEach((element) => {
      element.addEventListener('click', close);
    });

    window.addEventListener('keydown', (event) => {
      if(event.key === 'Escape' && !modal.classList.contains('hidden')){
        close();
      }
    });
  });
})();
