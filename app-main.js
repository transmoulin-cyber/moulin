import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// 1. CONFIGURACIÓN Y SESIÓN
const firebaseConfig = {
    apiKey: "AIzaSyCAsCocDQjimpjNo5l2oHTGO82XNTG7tzY",
    authDomain: "transporte-moulin.firebaseapp.com",
    databaseURL: "https://transporte-moulin-default-rtdb.firebaseio.com",
    projectId: "transporte-moulin",
    storageBucket: "transporte-moulin.firebasestorage.app",
    messagingSenderId: "1022730425566",
    appId: "1:1022730425566:web:1ec5b014b71d14ce579e4f"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const sesion = JSON.parse(sessionStorage.getItem('moulin_sesion'));
const PREFIJO_BASE = sesion?.prefijo || "REC";
const PREFIJO = (["TODO","ADM","REC"].includes(PREFIJO_BASE)) ? "RECON" : PREFIJO_BASE;
const NOMBRE_OP = sesion?.nombre || "Operador";

let proximoNumero = 1001;
let historialGlobal = [];
let retirosGlobal = [];

// 2. ESCUCHAS EN TIEMPO REAL (Firebase)
onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})) : [];
    renderRetiros();
});

// --- 2.1 CARGA UNIFICADA DE CLIENTES ---
onValue(ref(db, 'moulin/clientes'), (snapshot) => {
    const data = snapshot.val();
    // Guardamos en una lista global para que funcione en ambos formularios
    window.clientesGlobales = data ? Object.values(data) : [];
    
    // Llenamos el ÚNICO datalist que usan ambos (Remitente y Destinatario)
    const listaDL = document.getElementById('lista_clientes');
    if(listaDL) {
        listaDL.innerHTML = window.clientesGlobales
            .map(c => `<option value="${c.nombre}">`)
            .join('');
    }
});

// --- 2.2 MOTOR DE AUTOCOMPLETADO (PARA CUALQUIER BLOQUE) ---
const ejecutarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;

    // Escuchamos cuando el usuario elige un nombre de la lista
    input.addEventListener('change', (e) => {
        const nombreSel = e.target.value;
        // Buscamos en la lista global (no importa si es remitente o destinatario)
        const cliente = window.clientesGlobales.find(c => c.nombre === nombreSel);
        
        if (cliente) {
            // Llenamos los 5 campos del bloque correspondiente
            // Usamos 'd' para Dirección, 'l' para Localidad, 't' para Teléfono y 'cbu'
            if(document.getElementById(`${prefijo}_d`)) document.getElementById(`${prefijo}_d`).value = cliente.direccion || '';
            if(document.getElementById(`${prefijo}_l`)) document.getElementById(`${prefijo}_l`).value = cliente.localidad || '';
            if(document.getElementById(`${prefijo}_t`)) document.getElementById(`${prefijo}_t`).value = cliente.telefono || '';
            if(document.getElementById(`${prefijo}_cbu`)) document.getElementById(`${prefijo}_cbu`).value = cliente.cbu || '';
            
            console.log(`Autocompletado exitoso en bloque: ${prefijo}`);
        }
    });
};

// Activamos los sensores para ambos bloques usando la misma base de datos
ejecutarAutocompletado('r_n', 'r'); // Para el bloque Remitente
ejecutarAutocompletado('d_n', 'd'); // Para el bloque Destinatario
// --- 2.2 LÓGICA DE AUTOCOMPLETADO TOTAL (SALTO DE BLOQUE) ---
const configurarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;

    input.addEventListener('change', (e) => {
        const nombreSel = e.target.value;
        // Buscamos el cliente exacto
        const cliente = window.clientes.find(c => c.nombre === nombreSel);
        
        if (cliente) {
            // Llenamos todos los campos del bloque de una sola vez
            document.getElementById(`${prefijo}_d`).value = cliente.direccion || '';
            document.getElementById(`${prefijo}_l`).value = cliente.localidad || '';
            document.getElementById(`${prefijo}_t`).value = cliente.telefono || '';
            document.getElementById(`${prefijo}_cbu`).value = cliente.cbu || '';
            
            console.log(`Sistema: Datos de ${prefijo === 'r' ? 'Remitente' : 'Destinatario'} cargados.`);
        }
    });
};

// Activamos la función para los dos formularios
configurarAutocompletado('r_n', 'r');
configurarAutocompletado('d_n', 'd');

onValue(ref(db, 'moulin/guias'), (snapshot) => {
    const data = snapshot.val();
    historialGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, firebaseID: id})).reverse() : [];
    
    const misGuias = historialGlobal.filter(g => g.num.startsWith(PREFIJO));
    if (misGuias.length > 0) {
        const max = Math.max(...misGuias.map(g => parseInt(g.num.split('-')[1]) || 0));
        proximoNumero = max + 1;
    }
    document.getElementById('display_guia').innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;
    renderHistorial();
});

// 3. LÓGICA DE INTERFAZ (Tabs y Bultos)
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-content, .nav-tabs button').forEach(el => el.classList.remove('active'));
        document.getElementById(btn.dataset.tab).classList.add('active');
        btn.classList.add('active');
    });
});

document.getElementById('add-item').addEventListener('click', agregarFila);

function agregarFila() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" class="i-cant" value="1"></td>
        <td><select class="i-tipo"><option>Bulto</option><option>Pallet</option><option>Sobre</option></select></td>
        <td><input type="text" class="i-det"></td>
        <td><input type="number" class="i-unit" value="18000"></td>
        <td><input type="number" class="i-decl" value="0"></td>
        <td><button class="btn-del">✕</button></td>
    `;
    tr.querySelector('.btn-del').onclick = () => { tr.remove(); calcularTotales(); };
    tr.querySelectorAll('input').forEach(i => i.oninput = calcularTotales);
    document.getElementById('cuerpoItems').appendChild(tr);
    calcularTotales();
}

function calcularTotales() {
    let flete = 0, vdecl = 0;
    document.querySelectorAll('#cuerpoItems tr').forEach(r => {
        let c = parseFloat(r.querySelector('.i-cant').value) || 0;
        flete += c * (parseFloat(r.querySelector('.i-unit').value) || 0);
        vdecl += (parseFloat(r.querySelector('.i-decl').value) || 0);
    });
    let seg = vdecl * (parseFloat(document.getElementById('p_seg').value) / 100);
    let total = flete + seg;
    document.getElementById('total_txt').innerText = `TOTAL: $ ${total.toLocaleString()}`;
    return { total, v_decl: vdecl };
}

// 4. GRABADO E IMPRESIÓN (Las 3 Hojas)
document.getElementById('btn-emitir').onclick = async () => {
    const totales = calcularTotales();
    const guia = {
        num: `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`,
        fecha: new Date().toLocaleDateString(),
        operador: NOMBRE_OP,
        r_n: document.getElementById('r_n').value, r_l: document.getElementById('r_l').value, r_cbu: document.getElementById('r_cbu').value,
        d_n: document.getElementById('d_n').value, d_l: document.getElementById('d_l').value, d_d: document.getElementById('d_d').value, d_cbu: document.getElementById('d_cbu').value,
        items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
            cant: tr.querySelector('.i-cant').value, tipo: tr.querySelector('.i-tipo').value, det: tr.querySelector('.i-det').value
        })),
        total: totales.total,
        cr_monto: document.getElementById('cr_monto').value || 0,
        pago_en: document.getElementById('pago_en').value
    };

    if(!guia.r_n || !guia.d_n) return alert("Faltan datos de clientes.");

    await set(ref(db, `moulin/guias/${Date.now()}`), guia);
    imprimirTresHojas(guia);
    location.reload();
};

function imprimirTresHojas(g) {
    let etiquetas = "";
    let totalBultos = g.items.reduce((acc, item) => acc + parseInt(item.cant), 0);
    
    for(let i=1; i<=totalBultos; i++) {
        etiquetas += `<div class="etiqueta"><h2>MOULIN</h2><p>GUÍA: ${g.num}</p><p>DESTINO: ${g.d_l}</p><p>Bulto ${i} de ${totalBultos}</p></div>`;
    }

    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><link rel="stylesheet" href="estilos-moulin.css"></head><body>
            <div class="hoja-imp"><h1>COPIA REMITENTE</h1><p>Guía: ${g.num}</p><p>De: ${g.r_n}</p><p>Para: ${g.d_n}</p><p>Total: $${g.total}</p></div>
            <div class="page-break"></div>
            <div class="hoja-imp"><h1>COPIA DESTINATARIO</h1><p>Guía: ${g.num}</p><p>CR: $${g.cr_monto}</p></div>
            <div class="page-break"></div>
            <div class="hoja-etiquetas">${etiquetas}</div>
        </body></html>
    `);
    win.document.close();
    win.print();
}

// 5. RETIROS (Funciones Globales)
window.convertirAGuia = (id) => {
    const r = retirosGlobal.find(x => x.id === id);
    document.getElementById('r_n').value = r.r_lugar; 
    document.getElementById('r_l').value = r.r_loc;
    document.getElementById('d_n').value = r.s_nom;
    document.getElementById('d_l').value = r.s_loc;
    if(r.cr > 0) document.getElementById('cr_monto').value = r.cr;
    
    document.getElementById('btn-guia').click();
    update(ref(db, `moulin/retiros/${id}`), { estado: 'en_guia' });
};

function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    const pends = retirosGlobal.filter(r => r.estado === 'pendiente' && (PREFIJO_BASE === "TODO" || r.sucursal_retiro === PREFIJO));
    div.innerHTML = pends.map(r => `
        <div class="card-retiro">
            <p><b>RETIRAR EN:</b> ${r.r_lugar} (${r.r_loc})</p>
            <p><b>SOLICITA:</b> ${r.s_nom}</p>
            <button onclick="convertirAGuia('${r.id}')">PROCESAR</button>
        </div>
    `).join('');
    document.getElementById('badge-retiros').innerText = pends.length;
    document.getElementById('badge-retiros').style.display = pends.length ? 'block' : 'none';
}

function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    tbody.innerHTML = historialGlobal.slice(0,20).map(g => `
        <tr><td>${g.num}</td><td>${g.fecha}</td><td>${g.d_l}</td><td>$${g.total}</td><td>🖨️</td></tr>
    `).join('');
}

// Iniciar con una fila

agregarFila();

