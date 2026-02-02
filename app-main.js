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
window.clientesGlobales = []; 

// 2. ESCUCHAS EN TIEMPO REAL
onValue(ref(db, 'moulin/clientes'), (snapshot) => {
    const data = snapshot.val();
    window.clientesGlobales = data ? Object.values(data) : [];
    const listaDL = document.getElementById('lista_clientes');
    if(listaDL) {
        listaDL.innerHTML = window.clientesGlobales.map(c => `<option value="${c.nombre || c.n}">`).join('');
    }
    renderTablaClientes();
});

onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})) : [];
    renderRetiros();
});

onValue(ref(db, 'moulin/guias'), (snapshot) => {
    const data = snapshot.val();
    const todas = data ? Object.entries(data).map(([id, val]) => ({...val, firebaseID: id})).reverse() : [];
    historialGlobal = (PREFIJO_BASE === "TODO" || PREFIJO_BASE === "ADM") ? todas : todas.filter(g => g.num.startsWith(PREFIJO));
    
    const misGuias = todas.filter(g => g.num.startsWith(PREFIJO));
    if (misGuias.length > 0) {
        const nros = misGuias.map(g => parseInt(g.num.split('-')[1]) || 0);
        proximoNumero = Math.max(...nros) + 1;
    }
    document.getElementById('display_guia').innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;
    renderHistorial();
});

// 3. MOTOR DE AUTOCOMPLETADO (Traductor Moulin)
const ejecutarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;
    input.addEventListener('change', (e) => {
        const cliente = window.clientesGlobales.find(c => (c.nombre || c.n) === e.target.value);
        if (cliente) {
            const campos = {
                d: cliente.direccion || cliente.d || '',
                l: cliente.localidad || cliente.l || '',
                t: cliente.telefono || cliente.t || '',
                cbu: cliente.cbu || cliente.alias || ''
            };
            Object.keys(campos).forEach(k => {
                const el = document.getElementById(`${prefijo}_${k}`);
                if(el) el.value = (campos[k] === "undefined") ? "" : campos[k];
            });
        }
    });
};
ejecutarAutocompletado('r_n', 'r');
ejecutarAutocompletado('d_n', 'd');

// 4. CÁLCULOS Y FILAS
function agregarFila() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" class="i-cant" value="1"></td>
        <td><select class="i-tipo"><option>Bulto</option><option>Pallet</option><option>Sobre</option><option>Caja</option></select></td>
        <td><input type="text" class="i-det"></td>
        <td><input type="number" class="i-unit" value="18000"></td>
        <td><input type="number" class="i-decl" value="0"></td>
        <td><button class="btn-del">✕</button></td>
    `;
    tr.querySelector('.btn-del').onclick = () => { tr.remove(); calcularTotales(); };
    tr.querySelectorAll('input, select').forEach(i => i.oninput = calcularTotales);
    document.getElementById('cuerpoItems').appendChild(tr);
    calcularTotales();
}

function calcularTotales() {
    let flete = 0, vdecl = 0, cant_t = 0;
    document.querySelectorAll('#cuerpoItems tr').forEach(r => {
        let c = parseFloat(r.querySelector('.i-cant').value) || 0;
        flete += c * (parseFloat(r.querySelector('.i-unit').value) || 0);
        vdecl += (parseFloat(r.querySelector('.i-decl').value) || 0);
        cant_t += c;
    });
    let pSeg = parseFloat(document.getElementById('p_seg')?.value || 0.8);
    let seg = vdecl * (pSeg / 100);
    let total = flete + seg;
    const txt = document.getElementById('total_txt');
    if(txt) txt.innerText = `TOTAL: $ ${total.toFixed(2)}`;
    return { flete, seg, total, v_decl: vdecl, cant_t };
}

// 5. EMISIÓN Y GRABADO
document.getElementById('btn-emitir').onclick = async () => {
    const tot = calcularTotales();
    const r_n = document.getElementById('r_n').value.trim();
    const d_n = document.getElementById('d_n').value.trim();

    if(!r_n || !d_n) return alert("Faltan datos de clientes.");

    const guia = {
        num: document.getElementById('display_guia').innerText,
        fecha: new Date().toLocaleDateString(),
        operador: NOMBRE_OP,
        r_n, r_d: document.getElementById('r_d').value, r_l: document.getElementById('r_l').value, r_t: document.getElementById('r_t').value, r_cbu: document.getElementById('r_cbu').value,
        d_n, d_d: document.getElementById('d_d').value, d_l: document.getElementById('d_l').value, d_t: document.getElementById('d_t').value, d_cbu: document.getElementById('d_cbu').value,
        flete: tot.flete.toFixed(2), seg: tot.seg.toFixed(2), total: tot.total.toFixed(2), v_decl: tot.v_decl.toFixed(2), cant_t: tot.cant_t,
        pago_en: document.getElementById('pago_en').value,
        condicion: document.getElementById('condicion').value,
        items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
            c: tr.querySelector('.i-cant').value, t: tr.querySelector('.i-tipo').value, d: tr.querySelector('.i-det').value, u: tr.querySelector('.i-unit').value, vd: tr.querySelector('.i-decl').value
        }))
    };

    await set(ref(db, `moulin/guias/${Date.now()}`), guia);

    // Guardar/Actualizar Ficha de Cliente
    const guardarF = (n, d, l, t, c) => {
        if(!n) return;
        set(ref(db, `moulin/clientes/${n.replace(/[.#$/[\]]/g, "")}`), { nombre: n, direccion: d, localidad: l, telefono: t, cbu: c });
    };
    guardarF(guia.r_n, guia.r_d, guia.r_l, guia.r_t, guia.r_cbu);
    guardarF(guia.d_n, guia.d_d, guia.d_l, guia.d_t, guia.d_cbu);

    imprimirTresHojas(guia);
    setTimeout(() => location.reload(), 1000);
};

// 6. MOTOR DE IMPRESIÓN Y REIMPRESIÓN
window.reimprimirGuia = (num) => {
    const guia = historialGlobal.find(g => g.num === num);
    if (guia) {
        imprimirTresHojas(guia);
    } else {
        alert("No se encontró la información de la guía en el historial.");
    }
};

function imprimirTresHojas(g) {
    // Si la guía viene del historial viejo, los items pueden llamarse distinto
    let itemsH = g.items.map(i => `
        <tr>
            <td align="center">${i.c || i.cant}</td>
            <td>${i.t || i.tipo}</td>
            <td>${i.d || i.det}</td>
            <td align="right">$${i.u || i.unit || 0}</td>
            <td align="right">$${i.vd || i.v_decl || 0}</td>
        </tr>`).join('');

    let html = "";
    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `
        <div class="cupon">
            <div class="header-print">
                <img src="logo.png" class="logo-print" onerror="this.src='https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png'">
                <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;">
                    <small>${tit}</small><br>
                    <b style="font-size:22px; color:red;">${g.num}</b><br>
                    <b>${g.fecha}</b>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4;">
                <div style="border-right:1px solid #000; padding-right:8px;">
                    <b>REMITENTE:</b> ${g.r_n}<br>
                    Dir: ${g.r_d || ''}<br>
                    Tel: ${g.r_t || ''}<br>
                    Loc: <span class="resaltado">${g.r_l || ''}</span>
                </div>
                <div style="padding-left:8px;">
                    <b>DESTINATARIO:</b> ${g.d_n}<br>
                    Dir: ${g.d_d || ''}<br>
                    Tel: ${g.d_t || ''}<br>
                    Loc: <span class="resaltado">${g.d_l || ''}</span>
                </div>
            </div>
            <table class="tabla-items-print">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold;">
                <div>BULTOS: ${g.cant_t || g.items.length} | ${g.condicion} | <span class="resaltado">${g.pago_en}</span></div>
                <div style="text-align:right;">Flete: $${g.flete || 0} | Seg: $${g.seg || 0} | <span style="font-size:18px;">TOTAL: $${g.total}</span></div>
            </div>
        </div>`;
    });

    html += `
    <div class="etiqueta">
        <div style="width:33%;"><small>DESTINO:</small><br><b>${g.d_n}</b><br><span>${g.d_d || ''}</span><br><b class="resaltado">${g.d_l || ''}</b></div>
        <div style="width:33%; text-align:center;"><div id="qr_etiqueta" style="margin:auto; width:70px;"></div><b>${g.num}</b></div>
        <div style="width:33%; text-align:right;"><small>ORIGEN:</small><br><b>${g.r_n}</b><br><b class="resaltado">${g.r_l || ''}</b><br><div class="bultos-box">BULTOS: ${g.cant_t || g.items.length}</div></div>
    </div>`;

    const win = window.open('', '_blank');
    win.document.write(`<html><head><link rel="stylesheet" href="estilos-moulin.css"><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script></head><body>
    <div id="seccion-impresion">${html}</div>
    <script>
        setTimeout(()=>{ 
            new QRCode(document.getElementById("qr_etiqueta"),{text:"${g.num}",width:70,height:70}); 
            window.print(); 
            setTimeout(()=>window.close(),500); 
        },600);
    </script>
    </body></html>`);
    win.document.close();
}
// 7. INTERFAZ Y TABS
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-content, .nav-tabs button').forEach(el => el.classList.remove('active'));
        document.getElementById(btn.dataset.tab).classList.add('active');
        btn.classList.add('active');
    });
});

document.getElementById('add-item').addEventListener('click', agregarFila);
window.onload = () => { if(!document.getElementById('cuerpoItems').innerHTML) agregarFila(); };

// Render Historial y Clientes (simplificado)
function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(tbody) tbody.innerHTML = historialGlobal.slice(0,15).map(g => `<tr><td>${g.num}</td><td>${g.fecha}</td><td>${g.d_l}</td><td>$${g.total}</td><td>🖨️</td></tr>`).join('');
}

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(tbody) tbody.innerHTML = window.clientesGlobales.slice(0,20).map(c => `<tr><td><b>${c.nombre||c.n}</b></td><td>${c.direccion||c.d||'-'}</td><td>${c.localidad||c.l||'-'}</td><td>${c.telefono||c.t||'-'}</td><td><button onclick="eliminarCliente('${c.nombre||c.n}')">Borrar</button></td></tr>`).join('');
}

