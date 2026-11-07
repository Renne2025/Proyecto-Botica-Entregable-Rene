const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const ARCHIVO = path.join(__dirname, "datos.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Datos iniciales
const base = {
  productos: [
    { id: 1, nombre: "Paracetamol 500 mg", precio: 0.5, stock: 120, min: 30, vence: "2027-06-30" },
    { id: 2, nombre: "Ibuprofeno 400 mg", precio: 0.8, stock: 18, min: 25, vence: "2027-03-15" },
    { id: 3, nombre: "Amoxicilina 500 mg", precio: 1.2, stock: 40, min: 20, vence: "2026-12-01" },
    { id: 4, nombre: "Alcohol 70% 250 ml", precio: 4.5, stock: 8, min: 10, vence: "2028-01-10" },
    { id: 5, nombre: "Vitamina C 1 g", precio: 1.5, stock: 60, min: 20, vence: "2027-09-20" },
    { id: 6, nombre: "Mascarillas x unidad", precio: 0.5, stock: 200, min: 50, vence: "2029-01-01" }
  ],
  ventas: []
};

function leer() {
  if (!fs.existsSync(ARCHIVO)) escribir(base);
  return JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
}
function escribir(datos) {
  fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2));
}

// ---------- LOGIN Y SEGURIDAD ----------
function cifrar(clave, sal) {
  return crypto.scryptSync(clave, sal, 32).toString("hex");
}
function crearUsuario(usuario, clave, rol) {
  const sal = crypto.randomBytes(8).toString("hex");
  return { usuario, rol, sal, hash: cifrar(clave, sal) };
}
// Las contrasenas se guardan cifradas, no en texto plano
const usuarios = [
  crearUsuario("admin", "admin123", "admin"),
  crearUsuario("vendedor", "vendedor123", "vendedor")
];
const sesiones = {}; // token -> { usuario, rol }

app.post("/api/login", (req, res) => {
  const { usuario, clave } = req.body;
  const u = usuarios.find(x => x.usuario === usuario);
  if (!u || cifrar(String(clave || ""), u.sal) !== u.hash) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sesiones[token] = { usuario: u.usuario, rol: u.rol };
  res.json({ token, usuario: u.usuario, rol: u.rol });
});

// Todas las rutas /api siguientes exigen sesion iniciada
app.use("/api", (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sesion = sesiones[token];
  if (!sesion) return res.status(401).json({ error: "Sesión no válida, inicia sesión" });
  req.sesion = sesion;
  req.token = token;
  next();
});

function soloAdmin(req, res, next) {
  if (req.sesion.rol !== "admin") return res.status(403).json({ error: "Solo el administrador puede hacer esto" });
  next();
}

app.post("/api/logout", (req, res) => {
  delete sesiones[req.token];
  res.json({ ok: true });
});

// ---------- PRODUCTOS ----------
app.get("/api/productos", (req, res) => {
  res.json(leer().productos);
});

app.post("/api/productos", soloAdmin, (req, res) => {
  const { nombre, precio, stock, min, vence } = req.body;
  if (!nombre || precio == null || stock == null || !vence) {
    return res.status(400).json({ error: "Faltan datos del producto" });
  }
  const datos = leer();
  const nuevo = { id: Date.now(), nombre, precio: Number(precio), stock: Number(stock), min: Number(min) || 10, vence };
  datos.productos.push(nuevo);
  escribir(datos);
  res.status(201).json(nuevo);
});

app.put("/api/productos/:id/reponer", soloAdmin, (req, res) => {
  const cantidad = Number(req.body.cantidad);
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: "Cantidad invalida" });
  const datos = leer();
  const p = datos.productos.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: "Producto no encontrado" });
  p.stock += cantidad;
  escribir(datos);
  res.json(p);
});

app.delete("/api/productos/:id", soloAdmin, (req, res) => {
  const datos = leer();
  datos.productos = datos.productos.filter(x => x.id !== Number(req.params.id));
  escribir(datos);
  res.json({ ok: true });
});

// ---------- VENTAS ----------
app.get("/api/ventas", (req, res) => {
  res.json(leer().ventas);
});

app.post("/api/ventas", (req, res) => {
  const { items, cliente } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: "La venta no tiene productos" });

  const datos = leer();
  let total = 0;
  const detalle = [];

  // validar stock antes de descontar
  for (const it of items) {
    const p = datos.productos.find(x => x.id === it.id);
    if (!p) return res.status(404).json({ error: "Producto no encontrado" });
    if (it.cant > p.stock) return res.status(400).json({ error: "Stock insuficiente de " + p.nombre });
  }
  // descontar stock
  for (const it of items) {
    const p = datos.productos.find(x => x.id === it.id);
    p.stock -= it.cant;
    total += p.precio * it.cant;
    detalle.push(it.cant + " x " + p.nombre);
  }
  const venta = {
    n: datos.ventas.length + 1,
    fecha: new Date().toLocaleString("es-PE"),
    cliente: cliente || "Cliente general",
    vendedor: req.sesion.usuario,
    detalle: detalle.join(", "),
    total
  };
  datos.ventas.unshift(venta);
  escribir(datos);
  res.status(201).json(venta);
});

const PUERTO = 3000;
app.listen(PUERTO, () => console.log("Servidor listo en http://localhost:" + PUERTO));
