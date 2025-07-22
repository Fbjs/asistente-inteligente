function generarVariantes(nombre, rut) {
  const base = [
    `${nombre} contacto`,
    `${nombre} sitio web`,
    `${nombre} empresa`,
    `${nombre} dirección`,
    `${nombre} correo`,
    `${nombre} teléfono`,
    `${nombre} información`,
    `${nombre} oficina`,
    `${nombre} perfil`,
    `${nombre} página oficial`
  ];

  if (rut) {
    base.push(`${nombre} ${rut}`);
    base.push(`${rut} empresa`);
  }

  return base;
}

module.exports = generarVariantes;
