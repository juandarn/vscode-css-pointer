# React Sirius: CSS & Props Sync

VS Code extension para trabajar más rápido con proyectos React:

- 🔗 **CSS Pointer**: ve desde `className` / `id` en JSX/TSX directo a la definición en tus archivos CSS.
- 🧩 **React Props Sync**: sincroniza automáticamente las props de componentes React entre la **definición** y **todas sus referencias** en el proyecto.

---

## ✨ Features

### 1. CSS Pointer

Desde un archivo:

```tsx
export function Button() {
  return <button className="primary-button" id="main-cta">Click</button>;
}
````

La extensión:

* Detecta `className="primary-button"` y `id="main-cta"`.
* Busca en tus archivos CSS (según los globs configurados).
* Te permite:

  * **Go to Definition (F12)** sobre el nombre de la clase/id.
  * Ver un **hover** con el bloque CSS completo.

Ejemplo de CSS objetivo:

```css
.primary-button {
  padding: 0.75rem 1.25rem;
  border-radius: 999px;
}

#main-cta {
  font-weight: 600;
}
```

#### Soporta

* Atributos: `className`, `class`, `id`.
* Archivos: por defecto cualquier `**/*.css`, excluyendo `node_modules`.

Configuración (vía `settings.json`):

```jsonc
{
  "reactSirius.styleSearchGlobs": ["**/*.{css,scss,sass,less,styl}"],
  "reactSirius.styleSearchExclude": "**/node_modules/**"
}
```

---

### 2. React Props Sync (Auto-sync de props)

Te ayuda a mantener la **definición** del componente y **sus usos** sincronizados.

#### Flujos soportados

##### a) Definición ➜ Usos

Si tienes:

```tsx
// RequestServiceView.tsx
function RequestServiceView({ user, fuerte, suerte }) {
  // ...
}
export default RequestServiceView;
```

Y en otro archivo:

```tsx
<Route
  path="/solicitarServicio"
  element={<RequestServiceView user={user} />}
/>
```

Al guardar el archivo de la definición:

* La extensión ve que `RequestServiceView` tiene props: `user`, `fuerte`, `suerte`.
* Busca todos los usos `<RequestServiceView ... />`.
* Añade las props faltantes con un TODO:

```tsx
<Route
  path="/solicitarServicio"
  element={
    <RequestServiceView
      user={user}
      fuerte={/* TODO: completar */}
      suerte={/* TODO: completar */}
    />
  }
/>
```

Antes de aplicar los cambios, muestra un **diálogo de confirmación**.

##### b) Uso ➜ Definición + resto de usos

Si editas un uso:

```tsx
<RequestForm user={user} juan={user} />
```

Y tienes una definición:

```tsx
const RequestForm = ({ user }) => { ... };
// o
function RequestForm({ user }) { ... }
```

Al guardar:

1. La extensión detecta que en el uso hay una prop nueva: `juan`.

2. Busca la definición del componente (`RequestForm`).

3. Actualiza la definición:

   ```tsx
   const RequestForm = ({ user, juan }) => { ... }
   ```

4. Propaga la nueva prop a otros usos `<RequestForm />` que no la tengan.

También con **diálogo de confirmación** antes de tocar nada.

#### Patrones de componente soportados

Definiciones tipo:

```tsx
// function
function MyComponent({ foo, bar }) {
  // ...
}

export function MyComponent({ foo, bar }) {
  // ...
}

export default function MyComponent({ foo, bar }) {
  // ...
}

// arrow
const MyComponent = ({ foo, bar }) => {
  // ...
};

export const MyComponent = ({ foo, bar }) => {
  // ...
};

export default const MyComponent = ({ foo, bar }) => {
  // (poco común, pero cae igual)
};
```

Usos tipo:

```tsx
<MyComponent foo={1} bar={2} />
<MyComponent foo={foo} />
<Route element={<MyComponent foo={foo} />} />
```

#### Cosas que **no** hace (todavía)

* No entiende props **no destructuradas**:

  ```tsx
  function MyComponent(props) { ... } // no soportado
  ```

* No entiende definiciones súper dinámicas o fábrica de componentes raras.

* No “borra” props automáticamente si las quitas de un uso/definición (solo **añade**).

---

## 🚀 Cómo ejecutar la extensión localmente

1. Clona el repo:

   ```bash
   git clone https://github.com/juandarn/vscode-css-pointer.git
   cd vscode-css-pointer
   ```

2. Instala dependencias:

   ```bash
   npm install
   ```

3. Compila en modo watch mientras desarrollas:

   ```bash
   npm run watch
   ```

4. Arranca en modo extensión:

   * Abre esta carpeta en VS Code.
   * Ve a **Run and Debug**.
   * Selecciona la configuración: `Run Extension`.
   * Dale a ▶️ (F5).

Se abrirá una nueva ventana de VS Code (“Extension Development Host”).
Ahí es donde puedes abrir tu proyecto React y probar:

* Hovers y F12 sobre clases/id.
* Ediciones de componentes y props para ver la sincronización.

---

## ⚙️ Configuración

En `settings.json`:

```jsonc
{
  "reactSirius.styleSearchGlobs": [
    "**/*.{css,scss,sass,less,styl}"
  ],
  "reactSirius.styleSearchExclude": "**/node_modules/**"
}
```

En el futuro se podrán agregar opciones como:

* Activar/desactivar auto-sync de props.
* Cambiar la plantilla del TODO (`/* TODO: completar */`, `undefined`, etc.).
* Limitar los archivos donde se busca (`src/**`, etc.).

---

## 🧪 Limitaciones & Notas

* El análisis está basado en **regex**, no en un parser completo de TypeScript/JSX:

  * Es rápido y simple, pero no perfecto.
  * En casos complejos podría no detectar todos los patrones.
* Archivos de test se ignoran:

  * `*.test.*`, `*.spec.*`, carpetas `__tests__`, `tests`, `test`.
* No toca nada dentro de `node_modules`.

---

## 🔁 Versionado

Se usa [SemVer](https://semver.org/) clásico:

* `0.1.0` – primera versión usable.
* `0.1.x` – bugfixes y mejoras pequeñas.
* `0.2.0` – nuevas features compatibles.
* `1.0.0` – cuando ya esté más estable y probada en varios proyectos realistas.

---

## 🤝 Contribuir / Ideas

Cualquier idea o PR es bienvenida. Algunas ideas futuras:

* Soporte para props no destructuradas (`props.foo`).
* Integración con TypeScript para sugerir tipos.
* Mejor UI para mostrar el diff de cambios antes de aplicar.
* Soporte para otros frameworks/librerías que usen JSX-like.

---

## 🧑‍💻 Autor

Hecha con cariño por **@juandarn** ❤️
Repo: `https://github.com/juandarn/vscode-css-pointer.git`

