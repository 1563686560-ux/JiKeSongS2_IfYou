import { Engine } from './core/engine';
import { installDebug } from './debug/debugApi';
import './styles/base.css';

const root = document.querySelector<HTMLElement>('#app')!;
const engine = new Engine(root);
installDebug(engine);
void engine.start();
