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
            if(document.getElementById(`${prefijo}_d`)) document.getElementById(`${prefijo}_d`).value = cliente.direccion || cliente.d || '';
            if(document.getElementById(`${prefijo}_l`)) document.getElementById(`${prefijo}_l`).value = cliente.localidad || cliente.l || '';
            if(document.getElementById(`${prefijo}_t`)) document.getElementById(`${prefijo}_t`).value = cliente.telefono || cliente.t || '';
            if(document.getElementById(`${prefijo}_cbu`)) document.getElementById(`${prefijo}_cbu`).value = cliente.cbu || cliente.alias || '';
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
        const pago_en = document.getElementById('pago_en').value;
        const condicion = document.getElementById('condicion').value;
        
        if(!r_n || !d_n) return alert("⚠️ Faltan datos del Remitente o Destinatario.");

        const tot = calcularTotales();
        let cliente_deuda = (condicion === "CTA CTE") ? (pago_en === "PAGO EN ORIGEN" ? r_n : d_n) : "";

        const guia = {
            num: document.getElementById('display_guia').innerText,
            fecha: new Date().toLocaleDateString('es-AR'),
            timestamp: Date.now(),
            r_n, r_d: document.getElementById('r_d').value, r_l: document.getElementById('r_l').value,
            d_n, d_d: document.getElementById('d_d').value, d_l: document.getElementById('d_l').value,
            total: tot.total.toFixed(2), cant_t: tot.cant_t,
            pago_en, condicion, cliente_deuda,
            cr_activo: document.getElementById('cr_activo').value,
            cr_monto: document.getElementById('cr_monto').value || "0",
            operador: NOMBRE_OP,
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value, 
                t: tr.querySelector('.i-tipo').value, 
                d: tr.querySelector('.i-det').value, 
                u: tr.querySelector('.i-unit').value,
                vd: tr.querySelector('.i-decl').value
            }))
        };

        try {
            await set(ref(db, `moulin/guias/${guia.timestamp}`), guia);
            imprimir(guia);
            location.reload();
        } catch (e) { alert("Error al guardar"); }
    };
}

// 6. IMPRESIÓN
function imprimir(g) {
    const qrScript = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>`;
    const itemsH = g.items.map(i => `<tr><td align="center">${i.c}</td><td>${i.t}</td><td>${i.d}</td><td align="right">$${i.u}</td><td align="right">$${i.vd || 0}</td></tr>`).join('');
    let html = "";

    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `<div style="height: 10.5cm; border: 1px solid #000; padding: 10px; margin-bottom: 10px; box-sizing: border-box; display: flex; flex-direction: column; font-family: Arial;">
            <div style="display:flex; align-items:center;">
                <b style="font-size:18px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;"><small>${tit}</small><br><b style="font-size:22px; color:red;">${g.num}</b><br><b>${g.fecha}</b></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; font-size:12px;">
                <div style="border-right:1px solid #000; padding-right:8px;"><b>REMITENTE:</b> ${g.r_n}<br>Loc: ${g.r_l}</div>
                <div style="padding-left:8px;"><b>DESTINATARIO:</b> ${g.d_n}<br>Loc: ${g.d_l}</div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:11px; border:1px solid #000;">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px;">
                <div>BULTOS: ${g.cant_t} | ${g.condicion} ${g.cr_activo === 'SI' ? `<br><span style="color:red;">C/R: $${g.cr_monto}</span>` : ''}</div>
                <div style="text-align:right;">TOTAL: $${g.total}</div>
            </div>
            <div style="margin-top:auto; text-align:right;"><div style="border-top:1px solid #000; width:200px; text-align:center; margin-left:auto; font-size:11px;">Firma Receptor</div></div>
        </div>`;
    });

    const win = window.open('', '_blank');
    win.document.write(`<html><head>${qrScript}</head><body>${html}<script>window.onload = () => { window.print(); window.close(); }</script></body></html>`);
    win.document.close();
}

// 7. RENDERS
function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(!tbody) return;
    tbody.innerHTML = historialGlobal.slice(0, 15).map(g => `
        <tr><td>${g.num}</td><td>${g.fecha}</td><td>${g.d_l}</td><td>${g.condicion}</td>
        <td><button onclick="window.reimprimir('${g.num}')">🖨️</button></td></tr>`).join('');
}
window.reimprimir = (num) => { const g = historialGlobal.find(x => x.num === num); if(g) imprimir(g); };

function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if(!div) return;
    const pendientes = retirosGlobal.filter(r => r.estado !== "Realizado");
    div.innerHTML = pendientes.map(r => `
        <div class="caja" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; padding:10px; border-left:5px solid orange;">
            <div><b>${r.cliente || r.n}</b><br><small>${r.direccion} (${r.localidad})</small></div>
            <button onclick="window.pasarRetiroAGuia('${r.id}')" style="background:green; color:white; border:none; padding:5px 10px; cursor:pointer;">USAR ➔</button>
        </div>`).join('');
}

window.pasarRetiroAGuia = (id) => {
    const r = retirosGlobal.find(x => x.id === id);
    if(!r) return;
    document.getElementById('r_n').value = r.cliente || r.n || "";
    document.getElementById('r_d').value = r.direccion || "";
    document.getElementById('r_l').value = r.localidad || "";
    document.getElementById('r_t').value = r.telefono || "";
    document.getElementById('btn-guia').click(); // Cambia a pestaña guia
};

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;
    tbody.innerHTML = window.clientesGlobales.slice(0, 20).map(c => `
        <tr><td>${c.nombre || c.n}</td><td>${c.direccion || c.d}</td><td>${c.localidad || c.l}</td><td>-</td><td>-</td></tr>`).join('');
}

// 8. TABS (Corregido para coincidir con IDs del HTML)
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-tabs button, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab'); 
        document.getElementById(targetId).classList.add('active');
    };
});

window.onload = () => { if(document.getElementById('cuerpoItems')) window.agregarFila(); };
if(document.getElementById('add-item')) document.getElementById('add-item').onclick = window.agregarFila;
