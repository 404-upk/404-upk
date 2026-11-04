// Простые страницы без логики (ошибка 404, конфиденциальность): тема, живой фон и появление.

import { $, themeToggle } from "./core.js";
import { startAmbient } from "./ambient.js";
import { initMotion } from "./motion.js";

themeToggle($("#theme"));
startAmbient();
initMotion();
