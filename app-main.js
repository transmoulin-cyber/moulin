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
    // renderRetiros(); // Si tenés esta función definida en otro lado, descomentala
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

// 4. CÁLCULOS
function agregarFila() {
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
            
            // Función auxiliar interna para guardar cliente
            const guardarF = (n, d, l, t, c) => {
                if(!n) return;
                set(ref(db, `moulin/clientes/${n.replace(/[.#$/[\]]/g, "")}`), { nombre: n, direccion: d, localidad: l, telefono: t, cbu: c });
            };
            
            guardarF(guia.r_n, guia.r_d, guia.r_l, guia.r_t, guia.r_cbu);
            guardarF(guia.d_n, guia.d_d, guia.d_l, guia.d_t, guia.d_cbu);
            
            imprimirTresHojas(guia);
            setTimeout(() => location.reload(), 1000);
        } catch (error) {
            console.error(error);
            alert("Error al guardar.");
        }
    };
}

// 6. IMPRESIÓN
window.reimprimirGuia = (num) => {
    // Buscamos la guía en el historial
    const guia = window.historialGlobal.find(g => g.num === num);
    
    if (guia) {
        // Llamamos a la función de impresión que armamos recién
        imprimir(guia); 
    } else {
        alert("No se encontró la guía.");
    }
};
function imprimir(g) {
    let itemsH = g.items.map(i => `<tr><td align="center">${i.c}</td><td>${i.t}</td><td>${i.d}</td><td align="right">$${i.u}</td><td align="right">$${i.vd}</td></tr>`).join('');
    let html = "";
    
    // 1 y 2: ORIGINAL Y DUPLICADO (Tu diseño de 11cm)
    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `
        <div class="cupon">
            <div class="header-print">
                <img src="logo.png" class="logo-print" onerror="this.src='https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png'">
                <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;"><small>${tit}</small><br><b style="font-size:22px; color:red;">${g.num}</b><br><b>${g.fecha}</b></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4;">
                <div style="border-right:1px solid #000; padding-right:8px;">
                    <b style="font-size:14px;">REMITENTE:</b> ${g.r_n}<br>
                    Loc: <span class="resaltado">${g.r_l || ''}</span>
                </div>
                <div style="padding-left:8px;">
                    <b style="font-size:14px;">DESTINATARIO:</b> ${g.d_n}<br>
                    Loc: <span class="resaltado">${g.d_l || ''}</span>
                </div>
            </div>
            <table class="tabla-items-print">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px;">
                <div>BULTOS: ${g.cant_t || g.items.length} | ${g.condicion} | <span class="resaltado">${g.pago_en}</span></div>
                <div>TOTAL: $${g.total}</div>
            </div>
        </div>`;
    });

    // 3: LA ETIQUETA (Tu diseño de 4cm con QR)
    html += `
    <div class="etiqueta">
        <div style="width:33%; line-height:1.1;">
            <small>DESTINO:</small><br>
            <b style="font-size:15px;">${g.d_n}</b><br>
            <b class="resaltado" style="font-size:15px;">${g.d_l}</b>
        </div>
        <div style="width:33%; display:flex; flex-direction:column; align-items:center;">
            <div id="qr_etiqueta" style="width:70px; height:70px;"></div>
            <b style="font-size:14px; margin-top:3px;">${g.num}</b>
        </div>
        <div style="width:33%; text-align:right; line-height:1.1;">
            <small>ORIGEN:</small><br>
            <b class="resaltado">${g.r_l}</b><br>
            <div class="bultos-box">BULTOS: ${g.cant_t || g.items.length}</div>
        </div>
    </div>`;

    // Inyectamos en el div oculto y disparamos el QR
    const zona = document.getElementById('seccion-impresion');
    if(zona) {
        zona.innerHTML = html;
        setTimeout(() => {
            if(document.getElementById("qr_etiqueta")) {
                new QRCode(document.getElementById("qr_etiqueta"), { text: g.num, width: 70, height: 70 });
            }
            window.print();
        }, 300);
    }
}

// 7. ESTADOS Y TABS
window.cambiarEstado = (firebaseID, nuevoEstado) => {
    const updates = {};
    updates[`moulin/guias/${firebaseID}/estado`] = nuevoEstado;
    update(ref(db), updates).catch(e => alert("Error al actualizar"));
};

function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(!tbody) return;
    tbody.innerHTML = historialGlobal.slice(0,30).map(g => {
        const est = g.estado || "Recibido";
        let fondo = "";
        if(est === "Error") fondo = "background-color: #ffe5e5;";
        if(est === "Entregado") fondo = "background-color: #e5ffe5;";
        
        // Manejo seguro del ID de firebase
        const fid = g.firebaseID || '';

        return `
            <tr style="${fondo}">
                <td><b>${g.num}</b></td>
                <td>${g.fecha}</td>
                <td>${g.d_l || '-'}</td>
                <td>
                    <select onchange="cambiarEstado('${fid}', this.value)">
                        <option value="Recibido" ${est==="Recibido"?"selected":""}>Recibido</option>
                        <option value="Deposito" ${est==="Deposito"?"selected":""}>Deposito</option>
                        <option value="Entregado" ${est==="Entregado"?"selected":""}>Entregado</option>
                        <option value="Error" ${est==="Error"?"selected":""}>Error</option>
                    </select>
                </td>
                <td style="text-align:center;"><button onclick="reimprimirGuia('${g.num}')">🖨️</button></td>
            </tr>`;
    }).join('');
}

// 8. CUENTA CORRIENTE Y TABLA CLIENTES

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;
    
    tbody.innerHTML = (window.clientesGlobales || [])
        .filter(c => c.nombre || c.n)
        .slice(0,30)
        .map(c => {
            const nombreC = (c.nombre || c.n).trim().toUpperCase(); // Limpiamos el nombre del cliente
            
            // Buscamos deudas siendo flexibles con espacios y mayúsculas
            const pendientes = (window.historialGlobal || []).filter(g => {
                const remitente = (g.r_n || "").trim().toUpperCase();
                const destinatario = (g.d_n || "").trim().toUpperCase();
                return (remitente === nombreC || destinatario === nombreC) && 
                       (g.condicion === "CTA CTE") && 
                       (g.estado_facturacion !== "facturado");
            });
            
            const nombreSafe = nombreC.replace(/'/g, "\\'");
            const btnResumen = pendientes.length > 0 
                ? `<button onclick="generarResumenCtaCte('${nombreSafe}')" style="background:#f6ad55; font-weight:bold; border:none; padding:5px; cursor:pointer; border-radius:4px;">${pendientes.length} Pend.</button>` 
                : `<span style="color:#999;">Al día</span>`;

            return `<tr>
                <td><b>${nombreC}</b></td>
                <td>${c.direccion || '-'}</td>
                <td>${c.localidad || '-'}</td>
                <td align="center">${btnResumen}</td>
                <td><button onclick="eliminarCliente('${nombreSafe}')" style="background:#ff4444; color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;">Borrar</button></td>
            </tr>`;
        }).join('');
}
window.generarResumenCtaCte = async (cliente) => {
    // Verificamos si XLSX está cargado
    if (typeof XLSX === 'undefined') {
        alert("La librería XLSX no está cargada. Por favor recarga la página o verifica tu conexión.");
        return;
    }

    const aFacturar = historialGlobal.filter(g => 
        (g.r_n === cliente || g.d_n === cliente) && 
        (g.condicion === "CTA CTE") && 
        (g.estado_facturacion !== "facturado")
    );
    if (aFacturar.length === 0) return alert("Nada pendiente.");
    
    const total = aFacturar.reduce((acc, g) => acc + parseFloat(g.total || 0), 0);
    if(!confirm(`Resumen para: ${cliente}\nTotal: $${total.toFixed(2)}\n¿Descargar Excel y cerrar cuenta?`)) return;

    const datosExcel = aFacturar.map(g => ({
        "Fecha": g.fecha, 
        "Guía N°": g.num,
        "Tipo": (g.r_n === cliente) ? "SALIDA" : "ENTRADA",
        "Origen/Destino": (g.r_n === cliente) ? g.d_n : g.r_n,
        "Importe": parseFloat(g.total)
    }));

    try {
        const ws = XLSX.utils.json_to_sheet(datosExcel);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Resumen");
        XLSX.writeFile(wb, `Resumen_${cliente}.xlsx`);

        // Actualizamos estado en Firebase
        for (let guia of aFacturar) {
            if(guia.firebaseID) {
                await update(ref(db), { [`moulin/guias/${guia.firebaseID}/estado_facturacion`]: "facturado" });
            }
        }
        alert("Cuenta cerrada y actualizada.");
    } catch (e) { 
        console.error(e);
        alert("Error al exportar o actualizar."); 
    }
};

window.eliminarCliente = (nombre) => {
    if(confirm(`¿Eliminar a ${nombre}?`)) {
        set(ref(db, `moulin/clientes/${nombre.replace(/[.#$/[\]]/g, "")}`), null);
    }
};

// Listeners de Tabs
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-content, .nav-tabs button').forEach(el => el.classList.remove('active'));
        const tabContent = document.getElementById(btn.dataset.tab);
        if(tabContent) tabContent.classList.add('active');
        btn.classList.add('active');
    });
});

const addItemBtn = document.getElementById('add-item');
if (addItemBtn) addItemBtn.addEventListener('click', agregarFila);

window.onload = () => { if(document.getElementById('cuerpoItems') && !document.getElementById('cuerpoItems').innerHTML.trim()) agregarFila(); };


