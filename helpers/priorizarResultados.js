function priorizarResultados(urls, criterios) {
  const puntuadas = urls.map(url => {
    const dominio = extraerDominio(url);
    let score = 0;

    if (criterios.buenos_dominios.some(d => dominio.includes(d))) score += 3;
    if (criterios.malos_dominios.some(d => dominio.includes(d))) score -= 5;

    for (const palabra of criterios.palabras_buenas) {
      if (url.toLowerCase().includes(palabra)) score += 1;
    }

    for (const palabra of criterios.palabras_malas) {
      if (url.toLowerCase().includes(palabra)) score -= 1;
    }

    return { url, score };
  });

  return puntuadas
    .sort((a, b) => b.score - a.score)
    .map(item => item.url);
}

function extraerDominio(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return '';
  }
}

module.exports = priorizarResultados;
