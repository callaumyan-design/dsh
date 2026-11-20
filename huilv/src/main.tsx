import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

declare const __SINGLE_FILE__: boolean;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 仅在正式部署（https 或 localhost、非嵌入框架）时注册 Service Worker，实现离线可用
if (!__SINGLE_FILE__ && 'serviceWorker' in navigator && window.isSecureContext && window.top === window.self) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* 离线能力是增强功能，失败不影响使用 */
    });
}
