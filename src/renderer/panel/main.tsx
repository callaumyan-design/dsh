import { createRoot } from 'react-dom/client'
import '../shared/base.css'
import './panel.css'
import { PanelApp } from './PanelApp'

createRoot(document.getElementById('root')!).render(<PanelApp />)
