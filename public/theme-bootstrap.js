(function(){
  const storageKey = 'maplewood:theme';
  const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const applyTheme = (isDark) => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  };
  try{
    const stored = window.localStorage.getItem(storageKey);
    if(stored === 'dark' || stored === 'light'){
      applyTheme(stored === 'dark');
    }else{
      applyTheme(prefersDark());
    }
  }catch(error){
    applyTheme(prefersDark());
  }
})();
