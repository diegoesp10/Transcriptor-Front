# Avisos legales y licencias

Murmur es un proyecto independiente. **No está afiliado, patrocinado ni respaldado por Apple Inc.** Apple, macOS, iOS, iPadOS, SF Pro, SF Symbols y Liquid Glass son marcas de Apple Inc.; aquí solo se nombran para explicar la inspiración del diseño y no aparecen en la interfaz.

> Este documento recoge las decisiones que se tomaron para reducir el riesgo legal del diseño. **No es asesoramiento jurídico.** Antes de un lanzamiento comercial conviene que lo revise un abogado de propiedad intelectual de tu país.

## Qué se ha tomado de las pautas de diseño de Apple (y por qué es seguro)

Las [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) son públicas y describen **ideas y patrones funcionales**: listas agrupadas, controles segmentados, barras de pestañas, jerarquía tipográfica, colores del sistema, medidas táctiles de 44 px, vidrio translúcido en la capa de navegación. Las ideas, los métodos y los elementos puramente funcionales no están protegidos por derechos de autor, y usar un mismo patrón de interfaz no infringe nada por sí solo.

Lo que **sí** puede estar protegido es la expresión concreta: logotipos, iconos, fuentes, ilustraciones, fondos de pantalla, capturas y la apariencia reconocible y distintiva de un producto concreto. Por eso:

| No se usa | Qué se usa en su lugar |
|---|---|
| Logotipo de Apple, su franja de colores histórica, nombres de producto de Apple | Marca propia: un cuadrado azul con una onda de audio, dibujado desde cero (`public/favicon.svg`, `Navigation.tsx`) |
| Tipografía San Francisco (SF Pro) empaquetada o redistribuida | La pila de fuentes del sistema: en equipos Apple el navegador usa la SF que **ya está instalada**; no se incluye ningún archivo. En el resto, **Inter** (licencia SIL OFL 1.1, libre y redistribuible) |
| SF Symbols (su licencia los limita a apps para plataformas Apple) | **lucide-react** (licencia ISC), iconos de línea de código abierto |
| Iconos de apps, fondos, capturas o textos de Apple | Nada: toda la interfaz, los textos y el arte son propios |
| Copia fiel de pantallas concretas (Notas, Notas de voz, Ajustes…) | Patrones genéricos recombinados para esta app (por ejemplo, un botón de grabar rojo con anillo es un patrón universal, y la composición de la grabadora es propia) |
| Valores de color «de marca» de Apple | Los colores del sistema son valores funcionales que Apple publica para que las apps los usen; se usan como valores, sin ningún recurso gráfico |

Recomendaciones al publicar:
- No describir el producto como «estilo Apple», «como iOS» ni usar sus marcas en el nombre, la web o la publicidad.
- No añadir capturas ni material de Apple a la web o a la documentación.
- Si en el futuro se quiere un aspecto aún más fiel, revisar antes con un abogado qué elementos se reproducen.

## Componentes de terceros que se redistribuyen

| Componente | Licencia | Dónde está el texto |
|---|---|---|
| Inter (fuente variable, `@fontsource-variable/inter`) © The Inter Project Authors | SIL Open Font License 1.1 (uso comercial y redistribución permitidos; no se puede vender la fuente por separado) | `public/licenses/Inter-OFL-1.1.txt` |
| lucide-react © Lucide Icons and Contributors | ISC | `public/licenses/lucide-ISC.txt` |
| React, React DOM | MIT | `node_modules/react/LICENSE` |
| Vite (solo herramienta de compilación) | MIT | — |

Las licencias de las dependencias transitivas se pueden listar con `pnpm licenses list`.

## Datos y privacidad (relacionado, no de copyright)

La carpeta local y el almacenamiento del navegador contienen grabaciones de reuniones. Antes de usar la herramienta con clientes reales hay que cumplir la normativa de protección de datos aplicable (por ejemplo RGPD): base legal, información a los participantes grabados, retención y borrado, y acuerdos con el proveedor de transcripción. Ver `docs/LOCAL-STORAGE.md` del backend.
