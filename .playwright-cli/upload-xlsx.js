(async () => {
  // 用 DataTransfer + dispatchEvent 的方式直接设文件
  const inp = document.querySelector('input[type=file]');
  if (!inp) return 'NO_INPUT';

  // 用 fetch 读取本地文件（仅限已存在的页面上下文）
  // 更好的方式：用 XMLHttpRequest 同步读取
  // 实际上在浏览器里无法读取本地文件，所以换一种方法：
  // 直接用已经上传好的文件，或者用 Blob 模拟
  
  // 先尝试看看有没有已上传的
  if (inp.files.length > 0) return 'ALREADY_UPLOADED:' + inp.files[0].name;

  // 触发文件选择
  inp.click();
  return 'TRIGGERED_CHOOSER';
})()
