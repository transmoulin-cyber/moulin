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

// 3. AUTOCOMPLETADO
const ejecutarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;
    input.addEventListener('change', (e) => {
        const cliente = window.clientesGlobales.find(c => (c.nombre || c.n) === e.target.value);
        if (cliente) {
            const campos = { d: 'direccion', l: 'localidad', t: 'telefono', cbu: 'cbu' };
            Object.keys(campos).forEach(k => {
                const el = document.getElementById(`${prefijo}_${k}`);
                if(el) el.value = cliente[campos[k]] || cliente[k] || "";
            });
        }
    });
};
ejecutarAutocompletado('r_n', 'r');
ejecutarAutocompletado('d_n', 'd');

// 4. CÁLCULOS
window.agregarFila = function() {
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (!cuerpoItems) return;
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
    cuerpoItems.appendChild(tr);
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

// 5. EMISIÓN
const btnEmitir = document.getElementById('btn-emitir');
if (btnEmitir) {
    btnEmitir.onclick = async () => {
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
            estado: "Recibido",
            estado_facturacion: "pendiente",
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value, t: tr.querySelector('.i-tipo').value, d: tr.querySelector('.i-det').value, u: tr.querySelector('.i-unit').value, vd: tr.querySelector('.i-decl').value
            }))
        };

        try {
            await set(ref(db, `moulin/guias/${Date.now()}`), guia);
            const guardarF = (n, d, l, t, c) => {
                if(!n) return;
                set(ref(db, `moulin/clientes/${n.replace(/[.#$/[\]]/g, "")}`), { nombre: n, direccion: d, localidad: l, telefono: t, cbu: c });
            };
            guardarF(guia.r_n, guia.r_d, guia.r_l, guia.r_t, guia.r_cbu);
            guardarF(guia.d_n, guia.d_d, guia.d_l, guia.d_t, guia.d_cbu);
            
            imprimir(guia); 
            setTimeout(() => location.reload(), 1500);
        } catch (error) {
            alert("Error al guardar.");
        }
    };
}

// 6. IMPRESIÓN EXPORTE GLOBAL
window.reimprimirGuia = (num) => {
    const guia = historialGlobal.find(g => g.num === num);
    if (guia) imprimir(guia);
    else alert("No se encontró la guía.");
};

function imprimir(g) {
    let itemsH = g.items.map(i => `<tr><td align="center">${i.c}</td><td>${i.t}</td><td>${i.d}</td><td align="right">$${i.u}</td><td align="right">$${i.vd}</td></tr>`).join('');
    let html = "";
    
    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `
        <div class="cupon">
            <div class="header-print" style="display:flex; align-items:center;">
                <img src="logo.png" style="height:50px;" onerror="this.src='https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png'">
                <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;"><small>${tit}</small><br><b style="font-size:22px; color:red;">${g.num}</b><br><b>${g.fecha}</b></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px;">
                <div style="border-right:1px solid #000; padding-right:8px;"><b>REMITENTE:</b> ${g.r_n}<br>Loc: <b>${g.r_l || ''}</b></div>
                <div style="padding-left:8px;"><b>DESTINATARIO:</b> ${g.d_n}<br>Loc: <b>${g.d_l || ''}</b></div>
            </div>
            <table style="width:100%; border-collapse:collapse;" border="1">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold;">
                <div>BULTOS: ${g.cant_t} | ${g.condicion} | ${g.pago_en}</div>
                <div>TOTAL: $${g.total}</div>
            </div>
        </div>`;
    });

    html += `
    <div class="etiqueta" style="height:4cm; border:2px dashed #000; padding:10px; display:flex; justify-content:space-between; align-items:center; page-break-before:always;">
        <div style="width:30%">DESTINO:<br><b style="font-size:18px;">${g.d_l}</b><br><small>${g.d_n}</small></div>
        <div style="width:40%; text-align:center;"><div id="qr_etiqueta"></div><br><b>${g.num}</b></div>
        <div style="width:30%; text-align:right;">ORIGEN:<br><b>${g.r_l}</b><br>BULTOS: ${g.cant_t}</div>
    </div>`;

    const zona = document.getElementById('seccion-impresion');
    if(zona) {
        zona.innerHTML = html;
        setTimeout(() => {
            new QRCode(document.getElementById("qr_etiqueta"), { text: g.num, width: 80, height: 80 });
            window.print();
        }, 500);
    }
}
window.imprimir = imprimir; // ESTO ES CLAVE

// 7. ESTADOS Y TABS
window.cambiarEstado = (firebaseID, nuevoEstado) => {
    update(ref(db, `moulin/guias/${firebaseID}`), { estado: nuevoEstado }).catch(e => alert("Error"));
};

function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(!tbody) return;
    tbody.innerHTML = historialGlobal.slice(0,30).map(g => `
        <tr style="${g.estado === "Entregado" ? "background:#e5ffe5" : ""}">
            <td><b>${g.num}</b></td>
            <td>${g.fecha}</td>
            <td>${g.d_l || '-'}</td>
            <td>
                <select onchange="cambiarEstado('${g.firebaseID}', this.value)">
                    <option value="Recibido" ${g.estado==="Recibido"?"selected":""}>Recibido</option>
                    <option value="Entregado" ${g.estado==="Entregado"?"selected":""}>Entregado</option>
                </select>
            </td>
            <td align="center"><button onclick="reimprimirGuia('${g.num}')">🖨️</button></td>
        </tr>`).join('');
}

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;
    tbody.innerHTML = window.clientesGlobales.slice(0,30).map(c => {
        const nombreC = (c.nombre || c.n || "").toUpperCase();
        return `<tr>
            <td><b>${nombreC}</b></td>
            <td>${c.direccion || '-'}</td>
            <td>${c.localidad || '-'}</td>
            <td align="center">-</td>
            <td><button onclick="eliminarCliente('${nombreC}')" style="background:red; color:white;">Borrar</button></td>
        </tr>`;
    }).join('');
}

window.eliminarCliente = (nombre) => {
    if(confirm(`¿Eliminar a ${nombre}?`)) {
        set(ref(db, `moulin/clientes/${nombre.replace(/[.#$/[\]]/g, "")}`), null);
    }
};

// Listeners de Tabs
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-content, .nav-tabs button').forEach(el => el.classList.remove('active'));
        document.getElementById(btn.dataset.tab).classList.add('active');
        btn.classList.add('active');
    });
});

document.getElementById('add-item')?.addEventListener('click', agregarFila);
window.onload = () => { if(!document.getElementById('cuerpoItems').innerHTML) agregarFila(); };


