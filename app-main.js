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
        listaDL.innerHTML = window.clientesGlobales.map(c => `<option value="${c.nombre}">`).join('');
    }
    renderTablaClientes(); // <--- ESTO ACTIVA LA TABLA
});

onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})) : [];
    renderRetiros();
});

onValue(ref(db, 'moulin/guias'), (snapshot) => {
    const data = snapshot.val();
    const todas = data ? Object.entries(data).map(([id, val]) => ({...val, firebaseID: id})).reverse() : [];
    if (PREFIJO_BASE !== "TODO" && PREFIJO_BASE !== "ADM") {
        historialGlobal = todas.filter(g => g.num.startsWith(PREFIJO));
    } else {
        historialGlobal = todas;
    }
    const misGuias = todas.filter(g => g.num.startsWith(PREFIJO));
    if (misGuias.length > 0) {
        const nros = misGuias.map(g => parseInt(g.num.split('-')[1]) || 0);
        proximoNumero = Math.max(...nros) + 1;
    }
    document.getElementById('display_guia').innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;
    renderHistorial();
});

// 3. MOTOR DE AUTOCOMPLETADO (Diccionario Moulin V8.7)
//  LÓGICA DE EMISIÓN (Guardar y Mandar a Imprimir)
document.getElementById('btn-emitir').addEventListener('click', async () => {
    const r_n = document.getElementById('r_n').value.trim();
    const d_n = document.getElementById('d_n').value.trim();

    if (!r_n || !d_n) {
        alert("Por favor, completa los nombres de Remitente y Destinatario");
        return;
    }

    // Calculamos totales antes de guardar para tener los números listos
    const tot = calcularTotales(); 

    const guia = {
        num: document.getElementById('display-guia').innerText,
        fecha: new Date().toLocaleDateString(),
        // Datos del Remitente
        r_n: r_n,
        r_d: document.getElementById('r_d').value,
        r_l: document.getElementById('r_l').value,
        r_t: document.getElementById('r_t').value,
        r_cbu: document.getElementById('r_cbu').value,
        // Datos del Destinatario
        d_n: d_n,
        d_d: document.getElementById('d_d').value,
        r_l: document.getElementById('d_l').value, // Aquí se mapea a la localidad
        d_l: document.getElementById('d_l').value,
        d_t: document.getElementById('d_t').value,
        d_cbu: document.getElementById('d_cbu').value,
        // Totales (Lo que la impresora busca)
        flete: tot.flete.toFixed(2),
        seg: tot.seg.toFixed(2),
        total: tot.total.toFixed(2),
        v_decl: tot.v_decl.toFixed(2),
        cant_t: tot.cant_t,
        // Otros datos
        pago_en: document.getElementById('pago_en').value,
        condicion: document.getElementById('condicion').value,
        estado: 'recibido',
        items: Array.from(document.querySelectorAll('#contenedor-items .item-fila')).map(fila => ({
            c: fila.querySelector('.i-cant').value,
            t: fila.querySelector('.i-tipo').value,
            d: fila.querySelector('.i-det').value,
            u: fila.querySelector('.i-unit').value,
            vd: fila.querySelector('.i-decl').value
        }))
    };

    try {
        const nuevaGuiaRef = push(ref(db, 'moulin/guias'));
        await set(nuevaGuiaRef, guia);
        
        // AGREGAR: Guardado automático de clientes para que no falle la próxima vez
        await guardarClienteAutomatico('r');
        await guardarClienteAutomatico('d');

        // Llamamos a la impresora profesional que pegamos antes
        imprimirTresHojas(guia); 

        alert("Guía emitida con éxito");
        location.reload(); 
    } catch (error) {
        console.error("Error al emitir:", error);
        alert("Error al guardar la guía");
    }
});
// 4. LÓGICA DE INTERFAZ
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

// 5. GRABADO E IMPRESIÓN
document.getElementById('btn-emitir').onclick = async () => {
    const totales = calcularTotales();
    const cr_activo = document.getElementById('cr_activo').value;
    
    const guia = {
        num: `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`,
        fecha: new Date().toLocaleDateString(),
        operador: NOMBRE_OP,
        r_n: document.getElementById('r_n').value, r_d: document.getElementById('r_d').value,
        r_l: document.getElementById('r_l').value, r_t: document.getElementById('r_t').value, r_cbu: document.getElementById('r_cbu').value,
        d_n: document.getElementById('d_n').value, d_d: document.getElementById('d_d').value,
        d_l: document.getElementById('d_l').value, d_t: document.getElementById('d_t').value, d_cbu: document.getElementById('d_cbu').value,
        items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
            cant: tr.querySelector('.i-cant').value, tipo: tr.querySelector('.i-tipo').value, det: tr.querySelector('.i-det').value
        })),
        total: totales.total,
        cr_monto: cr_activo === 'SI' ? (document.getElementById('cr_monto').value || 0) : 0,
        pago_en: document.getElementById('pago_en').value,
        condicion: document.getElementById('condicion').value
    };

    if(!guia.r_n || !guia.d_n) return alert("Faltan datos de clientes.");

    await set(ref(db, `moulin/guias/${Date.now()}`), guia);

    // FUNCIÓN DE GUARDADO UNIVERSAL
    const guardarFicha = (nom, dir, loc, tel, cbu) => {
        if(!nom) return;
        const idLimpio = nom.replace(/[.#$/[\]]/g, "");
        const ficha = { nombre: nom, direccion: dir, localidad: loc, telefono: tel, cbu: cbu };
        set(ref(db, `moulin/clientes/${idLimpio}`), ficha);
    };

    guardarFicha(guia.r_n, guia.r_d, guia.r_l, guia.r_t, guia.r_cbu);
    guardarFicha(guia.d_n, guia.d_d, guia.d_l, guia.d_t, guia.d_cbu);

    imprimirTresHojas(guia);
    location.reload();
};

function imprimirTresHojas(g) {
    // 1. Preparar los items para la tabla
    let itemsH = g.items.map(i => `
        <tr>
            <td align="center">${i.cant || i.c}</td>
            <td>${i.tipo || i.t}</td>
            <td>${i.det || i.d}</td>
            <td align="right">$${i.unit || i.u || 0}</td>
            <td align="right">$${i.v_decl || i.vd || 0}</td>
        </tr>`).join('');

    let html = "";
    const logoPath = "logo.png";
    
    // 2. Generar Original y Duplicado (Tus cuadros negros)
    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `
        <div class="cupon">
            <div class="header-print">
                <img src="${logoPath}" class="logo-print" onerror="this.src='https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png'">
                <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                <div style="margin-left:auto; text-align:right;">
                    <small>${tit}</small><br>
                    <b style="font-size:22px; color:red;">${g.num}</b><br>
                    <b>${g.fecha}</b>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4;">
                <div style="border-right:1px solid #000; padding-right:8px;">
                    <b style="font-size:14px;">REMITENTE:</b> ${g.r_n}<br>
                    Dir: ${g.r_d || ''}<br>
                    Tel: ${g.r_t || ''} | CBU: ${g.r_cbu || ''}<br>
                    Loc: <span class="resaltado">${g.r_l || ''}</span>
                </div>
                <div style="padding-left:8px;">
                    <b style="font-size:14px;">DESTINATARIO:</b> ${g.d_n}<br>
                    Dir: ${g.d_d || ''}<br>
                    Tel: ${g.d_t || ''} | CBU: ${g.d_cbu || ''}<br>
                    Loc: <span class="resaltado">${g.d_l || ''}</span>
                </div>
            </div>
            <table class="tabla-items-print">
                <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>
            <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px;">
                <div>BULTOS: ${g.cant_t || g.items.length} | ${g.condicion} | <span class="resaltado">${g.pago_en}</span></div>
                <div style="text-align:right;">Flete: $${g.flete || 0} | Seg: $${g.seg || 0} | <span style="font-size:18px;">TOTAL: $${g.total}</span></div>
            </div>
            <div style="margin-top:auto; text-align:right;">
                <div style="border-top:1px solid #000; width:200px; text-align:center; margin-left:auto; font-size:11px;">Firma y Aclaración Receptor</div>
            </div>
        </div>`;
    });

    // 3. Etiqueta con QR
    html += `
    <div class="etiqueta">
        <div style="width:33%; line-height:1.1;">
            <small>DESTINO:</small><br>
            <b style="font-size:15px;">${g.d_n}</b><br>
            <span style="font-size:12px;">${g.d_d || ''}</span><br>
            <b class="resaltado" style="font-size:15px;">${g.d_l || ''}</b>
        </div>
        <div style="width:33%; display:flex; flex-direction:column; align-items:center;">
            <div id="qr_etiqueta" style="width:70px; height:70px;"></div>
            <b style="font-size:14px; margin-top:3px;">${g.num}</b>
        </div>
        <div style="width:33%; text-align:right; line-height:1.1;">
            <small>ORIGEN:</small><br>
            <b style="font-size:13px;">${g.r_n}</b><br>
            <b class="resaltado">${g.r_l || ''}</b><br>
            <div class="bultos-box">BULTOS: ${g.cant_t || g.items.length}</div>
        </div>
    </div>`;

    // 4. Inyectar y disparar impresión
    const win = window.open('', '_blank');
    win.document.write(`<html><head><link rel="stylesheet" href="estilos-moulin.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    </head><body>
    <div id="seccion-impresion">${html}</div>
    <script>
        setTimeout(() => {
            new QRCode(document.getElementById("qr_etiqueta"), { text: "${g.num}", width: 70, height: 70 });
            window.print();
            setTimeout(() => window.close(), 500);
        }, 500);
    </script>
    </body></html>`);
    win.document.close();
}

// 6. FUNCIONES DE RETIROS
window.convertirAGuia = (id) => {
    const r = retirosGlobal.find(x => x.id === id);
    document.getElementById('r_n').value = r.r_lugar; 
    document.getElementById('r_l').value = r.r_loc;
    document.getElementById('d_n').value = r.s_nom;
    document.getElementById('d_l').value = r.s_loc;
    if(r.cr > 0) {
        document.getElementById('cr_activo').value = 'SI';
        document.getElementById('cr_monto').style.display = 'block';
        document.getElementById('cr_monto').value = r.cr;
    }
    document.getElementById('btn-guia').click();
    update(ref(db, `moulin/retiros/${id}`), { estado: 'en_guia' });
};

function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if(!div) return;
    const pends = retirosGlobal.filter(r => r.estado === 'pendiente' && (PREFIJO_BASE === "TODO" || r.sucursal_retiro === PREFIJO));
    div.innerHTML = pends.map(r => `
        <div class="card-retiro">
            <p><b>RETIRAR EN:</b> ${r.r_lugar} (${r.r_loc})</p>
            <p><b>SOLICITA:</b> ${r.s_nom}</p>
            <button onclick="convertirAGuia('${r.id}')">PROCESAR</button>
        </div>
    `).join('');
    const b = document.getElementById('badge-retiros');
    if(b) { b.innerText = pends.length; b.style.display = pends.length ? 'block' : 'none'; }
}

function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(tbody) {
        tbody.innerHTML = historialGlobal.slice(0,20).map(g => `
            <tr><td>${g.num}</td><td>${g.fecha}</td><td>${g.d_l}</td><td>$${g.total}</td><td>🖨️</td></tr>
        `).join('');
    }
}

function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;
    const badge = document.getElementById('badge-clientes');
    if(badge) badge.innerText = window.clientesGlobales.length;

    tbody.innerHTML = window.clientesGlobales.map(c => {
        const d = c.direccion || c.dir || '<span style="color:red">Falta</span>';
        const l = c.localidad || c.loc || '-';
        const t = c.telefono || c.tel || '-';
        const cb = c.cbu || '-';
        return `<tr><td><b>${c.nombre}</b></td><td>${d}</td><td>${l}</td><td>${t}</td><td>${cb}</td><td><button onclick="eliminarCliente('${c.nombre}')" style="background:var(--rojo); color:white; border:none; padding:5px; border-radius:3px; cursor:pointer;">Borrar</button></td></tr>`;
    }).join('');
}

window.eliminarCliente = (nombre) => {
    if(confirm(`¿Estás seguro de borrar a ${nombre}?`)) {
        const idLimpio = nombre.replace(/[.#$/[\]]/g, "");
        set(ref(db, `moulin/clientes/${idLimpio}`), null);
    }
};

agregarFila();




