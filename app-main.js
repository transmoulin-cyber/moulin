import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// 1. CONFIGURACIÓN
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

// 2. ESCUCHAS DE FIREBASE
onValue(ref(db, 'moulin/clientes'), (snapshot) => {
    const data = snapshot.val();
    window.clientesGlobales = data ? Object.values(data) : [];
    const listaDL = document.getElementById('lista_clientes');
    if(listaDL) {
        listaDL.innerHTML = window.clientesGlobales
            .filter(c => c.nombre || c.n)
            .map(c => `<option value="${c.nombre || c.n}">`)
            .join('');
    }
    const badge = document.getElementById('badge-clientes');
    if(badge) badge.innerText = window.clientesGlobales.length;
    renderTablaClientes();
});

onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})).reverse() : [];
    const badge = document.getElementById('badge-retiros');
    if(badge) {
        const pendientes = retirosGlobal.filter(r => r.estado !== "Realizado").length;
        badge.innerText = pendientes;
        badge.style.display = pendientes > 0 ? "inline-block" : "none";
    }
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
    const displayGuia = document.getElementById('display_guia');
    if (displayGuia) {
        displayGuia.innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;
    }
    renderHistorial();
});

// 3. LÓGICA DE INTERFAZ
const ejecutarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;
    input.addEventListener('change', (e) => {
        const val = e.target.value;
        const cliente = window.clientesGlobales.find(c => (c.nombre || c.n) === val);
        if (cliente) {
            const d_d = cliente.direccion || cliente.d || '';
            const d_l = cliente.localidad || cliente.l || '';
            const d_t = cliente.telefono || cliente.t || '';
            const d_cbu = cliente.cbu || cliente.alias || '';
            if(document.getElementById(`${prefijo}_d`)) document.getElementById(`${prefijo}_d`).value = d_d;
            if(document.getElementById(`${prefijo}_l`)) document.getElementById(`${prefijo}_l`).value = d_l;
            if(document.getElementById(`${prefijo}_t`)) document.getElementById(`${prefijo}_t`).value = d_t;
            if(document.getElementById(`${prefijo}_cbu`)) document.getElementById(`${prefijo}_cbu`).value = d_cbu;
        }
    });
};
ejecutarAutocompletado('r_n', 'r');
ejecutarAutocompletado('d_n', 'd');

// 4. TABLA DE ÍTEMS
window.agregarFila = () => {
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (!cuerpoItems) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" class="i-cant" value="1" style="width:50px; text-align:center;"></td>
        <td><select class="i-tipo"><option>Bulto</option><option>Pallet</option><option>Sobre</option><option>Caja</option></select></td>
        <td><input type="text" class="i-det" placeholder="Descripción"></td>
        <td><input type="number" class="i-unit" value="18000"></td>
        <td><input type="number" class="i-decl" value="0"></td>
        <td><button type="button" class="btn-del" style="background:#ff4444; color:white; border:none; padding:5px 10px; cursor:pointer;">✕</button></td>
    `;
    tr.querySelector('.btn-del').onclick = () => { tr.remove(); calcularTotales(); };
    tr.querySelectorAll('input, select').forEach(i => i.oninput = calcularTotales);
    cuerpoItems.appendChild(tr);
    calcularTotales();
};

function calcularTotales() {
    let flete = 0, vdecl = 0, cant_t = 0;
    document.querySelectorAll('#cuerpoItems tr').forEach(r => {
        let c = parseFloat(r.querySelector('.i-cant').value) || 0;
        let u = parseFloat(r.querySelector('.i-unit').value) || 0;
        let d = parseFloat(r.querySelector('.i-decl').value) || 0;
        flete += c * u; vdecl += d; cant_t += c;
    });
    let pSeg = parseFloat(document.getElementById('p_seg')?.value || 0.8);
    let total = flete + (vdecl * (pSeg / 100));
    const txt = document.getElementById('total_txt');
    if(txt) txt.innerText = `TOTAL: $ ${total.toLocaleString('es-AR')}`;
    return { flete, seg: vdecl * (pSeg / 100), total, v_decl: vdecl, cant_t };
}

// 5. EMISIÓN
const btnEmitir = document.getElementById('btn-emitir');
if (btnEmitir) {
    btnEmitir.onclick = async () => {
        const r_n = document.getElementById('r_n').value.trim();
        const d_n = document.getElementById('d_n').value.trim();
        if(!r_n || !d_n) return alert("⚠️ Faltan datos.");
        const tot = calcularTotales();
        const guia = {
            num: document.getElementById('display_guia').innerText,
            fecha: new Date().toLocaleDateString(),
            r_n, r_d: document.getElementById('r_d').value, r_l: document.getElementById('r_l').value,
            d_n, d_d: document.getElementById('d_d').value, d_l: document.getElementById('d_l').value,
            total: tot.total.toFixed(2), cant_t: tot.cant_t,
            pago_en: document.getElementById('pago_en').value,
            condicion: document.getElementById('condicion').value,
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value, 
                t: tr.querySelector('.i-tipo').value, 
                d: tr.querySelector('.i-det').value, 
                u: tr.querySelector('.i-unit').value,
                vd: tr.querySelector('.i-decl').value
            }))
        };
        await set(ref(db, `moulin/guias/${Date.now()}`), guia);
        imprimir(guia);
        setTimeout(() => location.reload(), 1000);
    };
}

// 6. IMPRESIÓN ÚNICA Y CORREGIDA
function imprimir(g) {
    // 1. Cargamos el motor del QR dentro de la nueva ventana
    const qrScript = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>`;
    
    const itemsH = g.items.map(i => `<tr><td align="center">${i.c}</td><td>${i.t}</td><td>${i.d}</td><td align="right">$${i.u}</td><td align="right">$${i.vd || 0}</td></tr>`).join('');
    let html = "";

    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `<div style="height: 10.5cm; border: 1px solid #000; padding: 10px; margin-bottom: 10px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; font-family: Arial;">
            <div style="display:flex; align-items:center;">
                <img src="logo.png" style="height:45px;" onerror="this.src='https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png'">
                <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;"><small>${tit}</small><br><b style="font-size:22px; color:red;">${g.num}</b><br><b>${g.fecha}</b></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4; font-size:12px;">
                <div style="border-right:1px solid #000; padding-right:8px;">
                    <b>REMITENTE:</b> ${g.r_n}<br>Loc: <span style="background:#eee; font-weight:bold;">${g.r_l}</span>
                </div>
                <div style="padding-left:8px;">
                    <b>DESTINATARIO:</b> ${g.d_n}<br>Loc: <span style="background:#eee; font-weight:bold;">${g.d_l}</span>
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:11px; border:1px solid #000;">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px;">
                <div>BULTOS: ${g.cant_t} | ${g.condicion}</div>
                <div style="text-align:right;">TOTAL: $${g.total}</div>
            </div>
            <div style="margin-top:auto; text-align:right;"><div style="border-top:1px solid #000; width:200px; text-align:center; margin-left:auto; font-size:11px;">Firma Receptor</div></div>
        </div>`;
    });

    // ETIQUETA - Espacio para el QR con ID único
    html += `<div style="height: 3.5cm; border: 2px dashed #000; padding: 5px; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; overflow: hidden; font-family: Arial;">
        <div style="width:33%;">
            <small>DESTINO:</small><br><b style="font-size:14px;">${g.d_n}</b><br><b style="font-size:16px; background:#eee;">${g.d_l}</b>
        </div>
        <div style="width:33%; display:flex; flex-direction:column; align-items:center;">
            <div id="qrcode_final"></div>
            <b style="font-size:13px; margin-top:2px;">${g.num}</b>
        </div>
        <div style="width:33%; text-align:right;">
            <small>ORIGEN:</small> <b style="background:#eee;">${g.r_l}</b><br>
            <div style="border: 2px solid #000; display: inline-block; padding: 5px; margin-top:5px;">
                BULTOS: <b style="font-size:22px;">${g.cant_t}</b>
            </div>
        </div>
    </div>`;

    const win = window.open('', '_blank');
    win.document.write(`<html><head>${qrScript}<style>@page { size: auto; margin: 0.5cm; } body { margin: 0; }</style></head><body>
        ${html}
        <script>
            // Función que genera el QR una vez que la librería carga
            function generar() {
                if(typeof QRCode !== "undefined") {
                    new QRCode(document.getElementById("qrcode_final"), {
                        text: "${g.num}",
                        width: 70,
                        height: 70
                    });
                    setTimeout(() => { window.print(); window.close(); }, 500);
                } else {
                    setTimeout(generar, 100);
                }
            }
            window.onload = generar;
        </script>
    </body></html>`);
    win.document.close();
}

// 7. RENDERS
function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(!tbody) return;
    tbody.innerHTML = historialGlobal.slice(0, 20).map(g => `
        <tr><td>${g.num}</td><td>${g.fecha}</td><td>${g.d_l}</td><td>${g.estado || 'Recibido'}</td>
        <td><button onclick="window.reimprimir('${g.num}')">🖨️</button></td></tr>`).join('');
}
window.reimprimir = (num) => { const g = historialGlobal.find(x => x.num === num); if(g) imprimir(g); };

function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if(!div) return;
    div.innerHTML = retirosGlobal.map(r => `<div class="caja"><b>${r.cliente}</b> - ${r.direccion} <button onclick="window.completarRetiro('${r.id}')">✅</button></div>`).join('');
}
window.completarRetiro = (id) => update(ref(db, `moulin/retiros/${id}`), { estado: "Realizado" });

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;
    tbody.innerHTML = window.clientesGlobales.slice(0, 30).map(c => `<tr><td>${c.nombre || c.n}</td><td>${c.localidad || c.l}</td><td>-</td><td>-</td></tr>`).join('');
}

// 8. TABS
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-tabs button, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    };
});

window.onload = () => { if(document.getElementById('cuerpoItems')) window.agregarFila(); };
if(document.getElementById('add-item')) document.getElementById('add-item').onclick = window.agregarFila;

