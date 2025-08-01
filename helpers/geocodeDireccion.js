const axios = require('axios');

async function geocodeDireccion(direccion, comuna, region) {
  const fullAddress = `${direccion}, ${comuna}, ${region}, Chile`;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&addressdetails=1&limit=1`;

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'MiApp/1.0 (tucorreo@ejemplo.com)' // reemplaza con tu correo real
      }
    });

    if (response.data && response.data.length > 0) {
      const punto = response.data[0];
      console.log(`✅ Geocodificado: ${fullAddress} => lat: ${punto.lat}, lng: ${punto.lon}`);
      return {
        lat: punto.lat,
        lng: punto.lon
      };
    } else {
      console.warn(`⚠️ No se encontró resultado para: ${fullAddress}`);
    }
  } catch (error) {
    console.error('❌ Error al geocodificar:', error.message);
  }

  return { lat: '', lng: '' };
}

module.exports = geocodeDireccion;
