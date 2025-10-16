import './styles.css';
import { qsAll } from './src/utils/dom.js';

(function() {
      const fileInput = document.getElementById('source-image');
      const previewCanvas = document.getElementById('preview-canvas');
      const previewCtx = previewCanvas.getContext('2d');
      const previewPlaceholder = document.getElementById('preview-placeholder');
      const previewMeta = document.getElementById('preview-meta');
      const status = document.getElementById('helper-status');
      const downloadButtons = qsAll(document, '[data-download]');
      const backgroundInput = document.getElementById('background-color');
      const backgroundToggle = document.getElementById('apply-background');
      const colorButtons = qsAll(document, 'button[data-color], button[data-transparent]');

      let sourceImage = null;

      const setButtonsDisabled = (disabled) => {
        downloadButtons.forEach((button) => {
          button.disabled = disabled;
          button.setAttribute('aria-disabled', String(disabled));
        });
      };

      const updateStatus = (message, tone = 'info') => {
        status.textContent = message;
        status.dataset.tone = tone;
      };

      const getBackgroundColor = () => {
        return backgroundToggle.checked ? backgroundInput.value : null;
      };

      const drawToContext = (ctx, size) => {
        if (!sourceImage) {
          ctx.clearRect(0, 0, size, size);
          return;
        }
        const backgroundColor = getBackgroundColor();
        if (backgroundColor) {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, size, size);
        } else {
          ctx.clearRect(0, 0, size, size);
        }
        const scale = Math.min(size / sourceImage.width, size / sourceImage.height);
        const targetWidth = sourceImage.width * scale;
        const targetHeight = sourceImage.height * scale;
        const dx = (size - targetWidth) / 2;
        const dy = (size - targetHeight) / 2;
        ctx.drawImage(sourceImage, dx, dy, targetWidth, targetHeight);
      };

      const refreshPreview = () => {
        if (!sourceImage) {
          previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          previewPlaceholder.hidden = false;
          previewMeta.textContent = '';
          return;
        }
        drawToContext(previewCtx, previewCanvas.width);
        previewPlaceholder.hidden = true;
        previewMeta.textContent = `Previewing ${sourceImage.width}×${sourceImage.height}px → ${previewCanvas.width}×${previewCanvas.height}px artboard`;
      };

      const createCanvasForSize = (size) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        drawToContext(ctx, size);
        return canvas;
      };

      const downloadIcon = (size, format) => {
        if (!sourceImage) {
          updateStatus('Upload an image before downloading icons.', 'warning');
          return;
        }
        const canvas = createCanvasForSize(size);
        if (format === 'png') {
          const pngUrl = canvas.toDataURL('image/png');
          triggerDownload(pngUrl, `icon-${size}.png`);
          updateStatus(`Exported icon-${size}.png`, 'success');
        } else {
          const pngUrl = canvas.toDataURL('image/png');
          const backgroundColor = getBackgroundColor();
          const svgContent = [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
            backgroundColor ? `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>` : '',
            `<image width="${size}" height="${size}" href="${pngUrl}" />`,
            `</svg>`
          ].filter(Boolean).join('');
          const blob = new Blob([svgContent], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          triggerDownload(url, `icon-${size}.svg`);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          updateStatus(`Exported icon-${size}.svg`, 'success');
        }
      };

      const triggerDownload = (url, filename) => {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      };

      const handleFile = (file) => {
        if (!file) {
          return;
        }
        if (!file.type.startsWith('image/')) {
          updateStatus('Please choose an image file (PNG, JPEG, or SVG).', 'danger');
          fileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            sourceImage = img;
            refreshPreview();
            setButtonsDisabled(false);
            updateStatus(`Ready to export ${file.name}.`, 'success');
          };
          img.onerror = () => {
            updateStatus('Unable to read that image. Please try another file.', 'danger');
            sourceImage = null;
            refreshPreview();
            setButtonsDisabled(true);
          };
          img.src = event.target.result;
        };
        reader.onerror = () => {
          updateStatus('Unable to read that file. Please try again.', 'danger');
        };
        reader.readAsDataURL(file);
      };

      fileInput.addEventListener('change', (event) => {
        const [file] = event.target.files;
        handleFile(file);
      });

      backgroundInput.addEventListener('input', () => {
        if (!sourceImage) {
          return;
        }
        refreshPreview();
        updateStatus('Background color updated.', 'info');
      });

      backgroundToggle.addEventListener('change', () => {
        if (!sourceImage) {
          return;
        }
        refreshPreview();
        updateStatus(backgroundToggle.checked ? 'Background fill enabled.' : 'Background fill disabled.', 'info');
      });

      colorButtons.forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.color) {
            backgroundInput.value = button.dataset.color;
            backgroundToggle.checked = true;
          } else if ('transparent' in button.dataset) {
            backgroundToggle.checked = false;
          }
          refreshPreview();
          if (sourceImage) {
            updateStatus('Background preset applied.', 'info');
          }
        });
      });

      downloadButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const size = Number(button.dataset.size);
          const format = button.dataset.format;
          downloadIcon(size, format);
        });
      });

      setButtonsDisabled(true);
    })();
