# REIT Fair Value

Extensión de Chrome que compara el precio de mercado de REIT en [IEB Mas](https://hb.iebmas.com.ar/instrumento/REIT) con el fair value publicado en [reit.com.ar](https://reit.com.ar/api/metricas).

## Instalación (modo desarrollador)

1. Abrí `chrome://extensions` en Chrome.
2. Activá **Modo de desarrollador** (esquina superior derecha).
3. Clic en **Cargar descomprimida**.
4. Seleccioná la carpeta raíz de este repositorio (`reit-fair-value`).

## Uso

1. Iniciá sesión en IEB Mas si es necesario.
2. Navegá a `https://hb.iebmas.com.ar/instrumento/REIT`.
3. Aparecerá un modal flotante en la esquina superior derecha indicando si el precio está por encima o por debajo del fair value.
4. Podés arrastrar el modal desde el encabezado; la posición se guarda entre recargas.

## Estructura

```
reit-fair-value/
├── manifest.json
├── icons/
└── src/
    ├── background.js   # Fetch de API y caché
    ├── content.js      # Lectura de precio y modal
    └── styles.css
```

## API

La extensión consulta `GET https://reit.com.ar/api/metricas` y usa el campo `metricas.fair_value.valor`. Los datos se cachean 5 minutos.
