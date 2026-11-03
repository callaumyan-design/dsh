import { createRoot } from 'react-dom/client'
import '../shared/base.css'
import './pet.css'
import { PetApp } from './PetApp'

createRoot(document.getElementById('root')!).render(<PetApp />)
