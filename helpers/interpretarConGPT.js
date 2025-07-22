const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let totalTokens = 0; // Acumulador

async function interpretarConGPT(nombre, rut, texto) {
  const prompt = `
Analiza la siguiente información obtenida de distintas páginas web para la empresa "${nombre}" con RUT "${rut}". Extrae todo lo que puedas y organiza el resultado en este formato JSON:

{
  "empresa": "${nombre}",
  "rut": "${rut}",
  "sitio_web": "",
  "email": "",
  "telefono": "",
  "direccion": "",
  "comuna": "",
  "region": "",
  "descripcion": ""
}

No inventes información. Si un dato no está, deja el campo vacío. Usa solo información encontrada en el texto.

Texto:
"""
${texto}
"""
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Eres un experto en análisis de datos empresariales chilenos.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });

    const respuesta = completion.choices[0].message.content;

    // Extraer y mostrar tokens usados
    const { prompt_tokens, completion_tokens, total_tokens: usados } = completion.usage;
    console.log(`🧮 Tokens usados: prompt=${prompt_tokens}, respuesta=${completion_tokens}, total=${usados}`);
    totalTokens += usados;

    const jsonStart = respuesta.indexOf('{');
    const jsonEnd = respuesta.lastIndexOf('}');
    const jsonRaw = respuesta.substring(jsonStart, jsonEnd + 1);

    return JSON.parse(jsonRaw);
  } catch (error) {
    console.error('❌ Error interpretando con GPT:', error.message);
    return {
      sitio_web: '',
      email: '',
      telefono: '',
      direccion: '',
      comuna: '',
      region: '',
      descripcion: ''
    };
  }
}

// Exporta también el total para mostrar al final
module.exports = interpretarConGPT;
module.exports.getTotalTokens = () => totalTokens;
