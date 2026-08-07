(async () => {
  const r = await (await fetch('/api/rules')).json();
  const rule = r.find(x => x.name.includes('默认') || x.config?.engine === 'row');
  if (!rule) return 'NO_RULE';

  // 上传文件并提交
  const fileInput = document.querySelector('input[type=file]');
  // 先尝试通过 UI 操作
  
  // 等待页面稳定
  await new Promise(r => setTimeout(r, 2000));
  
  // 找到提交按钮
  const allBtns = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.textContent.trim().slice(0, 40),
    disabled: b.disabled,
    className: b.className.slice(0, 80)
  }));
  
  return JSON.stringify({ ruleId: rule.id, ruleName: rule.name, buttons: allBtns });
})()
