# Asistente Inteligente de Scraping y Enriquecimiento de Empresas

Este programa permite buscar información pública de empresas chilenas a partir de un archivo Excel, realizando búsquedas inteligentes en Google, extrayendo datos de sitios web y redes sociales, y utilizando IA para interpretar y normalizar los resultados.

## ¿Cómo funciona?

1. **Carga de empresas:**  
   El programa lee un archivo Excel con empresas y sus datos básicos.

2. **Búsqueda inteligente:**  
   Genera variantes de búsqueda y consulta la API de Google (Serper.dev) para obtener URLs relevantes.

3. **Scraping de sitios web:**  
   Extrae contenido de las páginas encontradas y de perfiles en redes sociales.

4. **Interpretación con IA:**  
   Envía el contenido extraído a la API de OpenAI (GPT) para identificar y normalizar datos clave: nombre, RUT, dirección, teléfono, email, sitio web, etc.

5. **Validación y comparación:**  
   Compara los datos encontrados con los originales (por ejemplo, dirección y nombre).

6. **Exportación de resultados:**  
   Guarda los resultados enriquecidos en un nuevo archivo Excel.

## APIs utilizadas

- [Serper.dev](https://serper.dev/) — Búsqueda inteligente en Google.
- [SerpApi](https://serpapi.com/) — Alternativa para búsquedas web (opcional).
- [OpenAI GPT](https://platform.openai.com/) — Interpretación y extracción de datos desde texto.
- Sitios web y redes sociales — Scraping de información pública.

## Configuración del archivo `.env`

Crea un archivo `.env` en la raíz del proyecto con el siguiente formato:

```env
SERPER_API_KEY=tu_api_key_de_serper
SERPAPI_KEY=tu_api_key_de_serpapi
OPENAI_API_KEY=tu_api_key_de_openai

SCRAPER_ALLOW_SOCIAL=1
```

- **SERPER_API_KEY:** Clave de acceso para la API de Serper.dev.
- **SERPAPI_KEY:** Clave de acceso para SerpApi (opcional).
- **OPENAI_API_KEY:** Clave de acceso para la API de OpenAI GPT.
- **SCRAPER_ALLOW_SOCIAL:** Si es `1`, permite scraping de redes sociales.

## Requisitos

- Node.js >= 18
- Dependencias instaladas con `npm install`
- Archivo `empresas.xlsx` con los datos de entrada

## Ejecución

```bash
node index.js
```

El resultado se guarda en `resultados.xlsx`.

---

**Nota:**  
No compartas tus claves API públicamente.  
Este programa está orientado a uso