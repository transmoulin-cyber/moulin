import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// ============================================
// CONFIGURACIÓN FIREBASE
// ============================================
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

// ============================================
// SESIÓN
// ============================================
const sesion = JSON.parse(sessionStorage.getItem('moulin_sesion'));
if (!sesion) {
    alert("No hay sesión activa");
    window.location.href = window.location.pathname.split('/').pop();
}

const PREFIJO_BASE = (sesion.prefijo || "RECON").toUpperCase();
const PREFIJO = (["TODO", "ADM", "REC"].includes(PREFIJO_BASE)) ? "RECON" : PREFIJO_BASE;
const NOMBRE_OP = sesion.nombre || "Operador";
const ES_ADMIN = ["TODO", "ADM"].includes(PREFIJO_BASE);
const NOMBRE_SUCURSAL = PREFIJO_BASE;

const PRECIOS_BASE = { "Bulto": 20000, "Pallet": 200000, "Sobre": 17000, "Caja": 20000 };

// ============================================
// ESTADO GLOBAL
// ============================================
window.historialGlobal = [];
window.clientesGlobal = [];
window.retirosGlobal = [];
window.repartidoresGlobal = [];
window.filtroEstadoActual = 'todos';
window.datosParaExcel = [];
let proximoNumero = 1001;
let proximoRetiro = 1;
let retiroAsociadoActual = null;

// ============================================
// TABS
// ============================================
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-tabs button, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
    };
});

// ============================================
// LISTENERS FIREBASE
// ============================================

// --- GUÍAS ---
onValue(ref(db, 'moulin/guias'), (snapshot) => {
    try {
        const data = snapshot.val();
        window.historialGlobal = data
            ? Object.entries(data).map(([id, val]) => ({ ...val, firebaseID: id })).reverse()
            : [];

        const misGuias = window.historialGlobal.filter(g => g?.num?.startsWith(PREFIJO));
        if (misGuias.length > 0) {
            const nros = misGuias.map(g => {
                const partes = g.num.split('-');
                return partes.length > 1 ? parseInt(partes[1]) : 0;
            }).filter(n => !isNaN(n));
            proximoNumero = nros.length > 0 ? Math.max(...nros) + 1 : 1001;
        } else {
            proximoNumero = 1001;
        }

        const display = document.getElementById('display_guia');
        if (display) display.innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;

        window.actualizarFiltroLocalidades();
        window.renderHistorial();
    } catch (e) {
        console.error("Error en listener guías:", e);
    }
});

// --- CLIENTES ---
onValue(ref(db, 'moulin/clientes'), (snapshot) => {
    const data = snapshot.val();
    window.clientesGlobal = data ? Object.entries(data).map(([key, val]) => ({
        nombre: (val.nombre || val.n || key.replace(/_/g, ' ')).toUpperCase().trim(),
        direccion: val.direccion || val.d || '',
        localidad: val.localidad || val.l || '',
        telefono: val.telefono || val.t || '',
        cbu: val.cbu || val.alias || ''
    })) : [];

    const listaDL = document.getElementById('lista_clientes');
    if (listaDL) {
        listaDL.innerHTML = window.clientesGlobal
            .filter(c => c.nombre)
            .map(c => `<option value="${c.nombre}">`)
            .join('');
    }

    const badge = document.getElementById('badge-clientes');
    if (badge) badge.innerText = window.clientesGlobal.length;

    if (typeof renderTablaClientes === 'function') {
        renderTablaClientes();
    }
});

// --- REPARTIDORES ---
onValue(ref(db, 'moulin/repartidores'), (snapshot) => {
    const data = snapshot.val();
    window.repartidoresGlobal = data ? Object.entries(data).map(([id, val]) => ({ ...val, firebaseID: id })) : [];
    window.renderHistorial();
});

// --- RETIROS ---
onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    window.retirosGlobal = data
        ? Object.entries(data).map(([id, val]) => ({ ...val, firebaseID: id })).reverse()
        : [];

    const numsRetiro = window.retirosGlobal
        .map(r => {
            if (!r.num_retiro) return 0;
            const partes = r.num_retiro.split('-');
            return partes.length >= 3 ? parseInt(partes[2]) || 0 : 0;
        })
        .filter(n => !isNaN(n));
    proximoRetiro = numsRetiro.length > 0 ? Math.max(...numsRetiro) + 1 : 1;

    const pendientesVisibles = window.retirosGlobal.filter(r =>
        r.estado === 'pendiente' && puedeVerRetiro(r)
    );
    const badge = document.getElementById('badge-retiros');
    if (badge) {
        badge.innerText = pendientesVisibles.length;
        badge.style.display = pendientesVisibles.length > 0 ? "inline-block" : "none";
    }

    if (typeof renderRetiros === 'function') renderRetiros();
});

function puedeVerRetiro(r) {
    if (ES_ADMIN) return true;
    const localidad = (r.localidad || '').toUpperCase();
    const pedidoPor = (r.pedido_por || '').toUpperCase();
    return localidad === NOMBRE_SUCURSAL || pedidoPor === NOMBRE_SUCURSAL;
}

// ============================================
// AUTOCOMPLETADO DE CLIENTES
// ============================================
window.completarCliente = (tipo) => {
    const inputElem = document.getElementById(`${tipo}_n`);
    if (!inputElem) return;
    
    const valorBuscado = inputElem.value.trim().toLowerCase();
    if (!valorBuscado) return;

    const cliente = window.clientesGlobal.find(c => {
        const nombreC = (c.nombre || '').trim().toLowerCase();
        return nombreC === valorBuscado || nombreC.includes(valorBuscado);
    });

    if (cliente) {
        document.getElementById(`${tipo}_d`).value = cliente.direccion || '';
        
        const selectLoc = document.getElementById(`select_${tipo}_l`);
        const locVal = cliente.localidad || '';
        if (selectLoc && locVal) {
            let encontrada = false;
            for (let opt of selectLoc.options) {
                if (opt.value.toUpperCase() === locVal.toUpperCase()) {
                    selectLoc.value = opt.value;
                    encontrada = true;
                    break;
                }
            }
            if (!encontrada) {
                selectLoc.value = 'OTRA';
                if (typeof window.gestionarOtraLocalidad === 'function') {
                    window.gestionarOtraLocalidad(tipo);
                }
                const inputOtra = document.getElementById(`${tipo}_l_otra`);
                if (inputOtra) inputOtra.value = locVal;
            }
        } else {
            const inputLoc = document.getElementById(`${tipo}_l`);
            if (inputLoc) inputLoc.value = locVal;
        }

        document.getElementById(`${tipo}_t`).value = cliente.telefono || '';
        document.getElementById(`${tipo}_cbu`).value = cliente.cbu || '';
    }
};

// ============================================
// GESTIÓN DE LOCALIDADES
// ============================================
window.gestionarOtraLocalidad = (tipo) => {
    let selectId, inputOtraId, inputHiddenId;
    
    if (tipo === 'r') {
        selectId = 'select_r_l';
        inputOtraId = 'r_l_otra';
        inputHiddenId = 'r_l';
    } else if (tipo === 'd') {
        selectId = 'select_d_l';
        inputOtraId = 'd_l_otra';
        inputHiddenId = 'd_l';
    } else if (tipo === 'ret') {
        selectId = 'select_ret_localidad';
        inputOtraId = 'ret_localidad_otra';
        inputHiddenId = 'ret_localidad';
    }
    
    const select = document.getElementById(selectId);
    const inputOtra = document.getElementById(inputOtraId);
    const inputHidden = document.getElementById(inputHiddenId);
    
    if (!select || !inputOtra || !inputHidden) return;

    if (select.value === 'OTRA') {
        inputOtra.style.display = 'block';
        inputOtra.focus();
        inputHidden.value = '';
    } else {
        inputOtra.style.display = 'none';
        inputOtra.value = '';
        inputHidden.value = select.value;
    }
};

// ============================================
// FILTRADO DE LOCALIDADES
// ============================================
window.actualizarFiltroLocalidades = function () {
    const localidades = new Set();
    window.historialGlobal.forEach(g => {
        if (g.d_l) localidades.add(g.d_l.trim().toUpperCase());
        if (g.r_l) localidades.add(g.r_l.trim().toUpperCase());
    });
    const select = document.getElementById('f_localidad');
    if (!select) return;
    const valorActual = select.value;
    const sorted = Array.from(localidades).sort();
    select.innerHTML = '<option value="TODAS">-- Todas las localidades --</option>' +
        sorted.map(l => `<option value="${l}">${l}</option>`).join('');
    if (sorted.includes(valorActual)) select.value = valorActual;
};

// ============================================
// TABLA DE ÍTEMS (BULTOS, PRECIOS Y TOTALES)
// ============================================
window.agregarFila = () => {
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (!cuerpoItems) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" class="i-cant" value="1" min="1" oninput="calcularTotales()"></td>
        <td><select class="i-tipo" onchange="actualizarPrecioXDefecto(this)">
            <option>Bulto</option><option>Pallet</option><option>Sobre</option><option>Caja</option>
        </select></td>
        <td><input type="text" class="i-det" placeholder="Detalle"></td>
        <td><input type="number" class="i-unit" value="20000" min="0" oninput="calcularTotales()"></td>
        <td><input type="number" class="i-decl" value="0" min="0" oninput="calcularTotales()"></td>
        <td><button onclick="this.parentElement.parentElement.remove(); calcularTotales();" style="background:#e53e3e; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">✕</button></td>`;
    cuerpoItems.appendChild(tr);
    calcularTotales();
};

window.actualizarPrecioXDefecto = (inputTipo) => {
    inputTipo.closest('tr').querySelector('.i-unit').value = PRECIOS_BASE[inputTipo.value] || 0;
    calcularTotales();
};

window.calcularTotales = function () {
    let flete = 0, vdecl = 0, cant_t = 0;
    document.querySelectorAll('#cuerpoItems tr').forEach(r => {
        const c = parseFloat(r.querySelector('.i-cant').value) || 0;
        flete += c * (parseFloat(r.querySelector('.i-unit').value) || 0);
        vdecl += parseFloat(r.querySelector('.i-decl').value) || 0;
        cant_t += c;
    });
    const pSeg = parseFloat(document.getElementById('p_seg')?.value || 0.8);
    const seg = vdecl * (pSeg / 100);
    const total = flete + seg;
    const txt = document.getElementById('total_txt');
    if (txt) {
        txt.innerHTML = `<small style="font-size:12px; color:#ccc;">Bultos: ${cant_t} | Flete: $${flete.toLocaleString('es-AR')} | Seg: $${seg.toFixed(2)}</small><br>TOTAL: $ ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    }
    return { flete, seg, total, v_decl: vdecl, cant_t };
};

// Inicializamos la primera fila por defecto al cargar el script si la tabla existe
document.addEventListener("DOMContentLoaded", () => {
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (cuerpoItems && cuerpoItems.children.length === 0) {
        agregarFila();
    }
});

// ============================================
// LIMPIAR FORMULARIO
// ============================================
window.limpiarFormulario = function () {
    ['r_n', 'r_t', 'r_d', 'r_l', 'r_cbu', 'd_n', 'd_t', 'd_d', 'd_l', 'd_cbu', 'cr_monto'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (cuerpoItems) cuerpoItems.innerHTML = '';
    
    window.retiroAsociadoActual = null;
    
    const avisoRetiro = document.getElementById('aviso-retiro');
    if (avisoRetiro) avisoRetiro.style.display = 'none';
    
    agregarFila();
};

// ============================================
// EMISIÓN DE GUÍA
// ============================================
const btnEmitir = document.getElementById('btn-emitir');
if (btnEmitir) {
    btnEmitir.onclick = async () => {
        const r_n = document.getElementById('r_n').value.trim();
        const d_n = document.getElementById('d_n').value.trim();
        if (!r_n || !d_n) return alert("⚠️ Faltan datos de clientes.");

        const r_l_select = document.getElementById('select_r_l').value;
        const r_l_final = r_l_select === 'OTRA' ? document.getElementById('r_l_otra').value.trim() : r_l_select;

        const d_l_select = document.getElementById('select_d_l').value;
        const d_l_final = d_l_select === 'OTRA' ? document.getElementById('d_l_otra').value.trim() : d_l_select;

        if (!r_l_select) return alert("⚠️ Seleccioná la localidad del remitente.");
        if (!d_l_select) return alert("⚠️ Seleccioná la localidad del destinatario.");
        if (r_l_select === 'OTRA' && !r_l_final) return alert("⚠️ Ingresá la localidad del remitente en el campo 'OTRA'.");
        if (d_l_select === 'OTRA' && !d_l_final) return alert("⚠️ Ingresá la localidad del destinatario en el campo 'OTRA'.");

        const tot = calcularTotales();
        if (tot.cant_t === 0) return alert("⚠️ Debes agregar al menos un bulto.");

        const idU = Date.now();
        const nroGuia = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;

        const guia = {
            num: nroGuia,
            fecha: new Date().toLocaleDateString('es-AR'),
            timestamp: Date.now(),
            r_n, r_d: document.getElementById('r_d').value, r_l: r_l_final,
            r_t: document.getElementById('r_t').value, r_cbu: document.getElementById('r_cbu').value,
            d_n, d_d: document.getElementById('d_d').value, d_l: d_l_final,
            d_t: document.getElementById('d_t').value, d_cbu: document.getElementById('d_cbu').value,
            flete: tot.flete.toFixed(2), seg: tot.seg.toFixed(2), total: tot.total.toFixed(2),
            v_decl: tot.v_decl.toFixed(2), cant_t: tot.cant_t,
            pago_en: document.getElementById('pago_en').value,
            condicion: document.getElementById('condicion').value,
            cr_activo: document.getElementById('cr_activo').value,
            cr_monto: document.getElementById('cr_monto').value || "0",
            p_seg_aplicado: document.getElementById('p_seg').value,
            estado: 'recibido',
            emisor: NOMBRE_OP,
            retiro_asociado: retiroAsociadoActual || '',
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value, t: tr.querySelector('.i-tipo').value,
                d: tr.querySelector('.i-det').value, u: tr.querySelector('.i-unit').value,
                vd: tr.querySelector('.i-decl').value
            }))
        };

        try {
            await set(ref(db, `moulin/guias/${idU}`), guia);

            const guardarClienteForzado = async (nombre, dir, loc, tel, cbu) => {
                if (!nombre || !nombre.trim()) return;
                const key = nombre.trim().toUpperCase().replace(/[.#$/[\]]/g, "_");
                await set(ref(db, `moulin/clientes/${key}`), {
                    nombre: nombre.trim().toUpperCase(),
                    direccion: dir || '',
                    localidad: loc || '',
                    telefono: tel || '',
                    cbu: cbu || '',
                    ultimaActualizacion: Date.now()
                });
            };

            await guardarClienteForzado(r_n, document.getElementById('r_d').value, r_l_final, document.getElementById('r_t').value, document.getElementById('r_cbu').value);
            await guardarClienteForzado(d_n, document.getElementById('d_d').value, d_l_final, document.getElementById('d_t').value, document.getElementById('d_cbu').value);

            if (retiroAsociadoActual) {
                const retiro = window.retirosGlobal.find(r => r.num_retiro === retiroAsociadoActual);
                if (retiro) {
                    await update(ref(db, `moulin/retiros/${retiro.firebaseID}`), {
                        estado: 'realizado',
                        realizadoPor: NOMBRE_OP,
                        fechaRealizado: new Date().toLocaleDateString('es-AR'),
                        guiaAsociada: nroGuia
                    });
                }
            }

            imprimir(guia);
            limpiarFormulario();
            proximoNumero++;
        } catch (e) {
            console.error("❌ ERROR CRÍTICO AL GUARDAR:", e);
            alert("❌ Error al guardar: " + e.message);
        }
    };
}

// ============================================
// IMPRESIÓN DE GUÍA INDIVIDUAL
// ============================================
window.reimprimir = function(numGuia) {
    const g = window.historialGlobal.find(item => item.num === numGuia);
    if (!g) return alert("⚠️ Guía no encontrada.");
    imprimir(g);
};

function imprimir(g) {
    const itemsH = (g.items || []).map(i => `
        <tr><td align="center">${i.c}</td><td>${i.t}</td><td>${i.d || ''}</td>
        <td align="right">$${i.u}</td><td align="right">$${i.vd}</td></tr>`).join('');

    let html = "";
    const logoPath = "logo.png";
    const fallbackLogo = "https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png";
    const lineaRetiro = g.retiro_asociado ? `<div style="background:#fff3cd; padding:4px 8px; text-align:center; font-size:12px; border:1px solid #ccc;">🚚 Retiro asociado: <b>${g.retiro_asociado}</b></div>` : '';

    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach((tit) => {
        html += `
            <div class="cupon">
                <div class="header-print">
                    <img src="${logoPath}" class="logo-print" onerror="this.src='${fallbackLogo}'">
                    <b style="font-size:18px; margin-left:10px;">TRANSPORTE MOULIN</b>
                    <div style="margin-left:auto; text-align:right;">
                        <small>${tit}</small><br>
                        <b style="font-size:22px; color:red;">${g.num}</b><br>
                        <b>${g.fecha}</b>
                    </div>
                </div>
                ${lineaRetiro}
                <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4;">
                    <div style="border-right:1px solid #000; padding-right:8px;">
                        <b style="font-size:14px;">REMITENTE:</b> ${g.r_n}<br>
                        Dir: ${g.r_d}<br>Tel: ${g.r_t} | CBU: ${g.r_cbu}<br>
                        Loc: <span class="resaltado">${g.r_l}</span>
                    </div>
                    <div style="padding-left:8px;">
                        <b style="font-size:14px;">DESTINATARIO:</b> ${g.d_n}<br>
                        Dir: ${g.d_d}<br>Tel: ${g.d_t} | CBU: ${g.d_cbu}<br>
                        Loc: <span class="resaltado">${g.d_l}</span>
                    </div>
                </div>
                <table class="tabla-items-print">
                    <thead><tr style="background:#eee;"><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                    <tbody>${itemsH}</tbody>
                </table>
                <div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px;">
                    <div>BULTOS: ${g.cant_t} | ${g.condicion} | <span class="resaltado">${g.pago_en}</span></div>
                   <div style="text-align:right;">Flete: $${g.flete} | V.Dec: $${g.v_decl} | Seg: $${g.seg} | <span style="font-size:18px;">TOTAL: $${g.total}</span></div>
                </div>
                <div style="margin-top:auto; text-align:right;">
                    <div style="border-top:1px solid #000; width:200px; text-align:center; margin-left:auto; font-size:11px;">Firma y Aclaración Receptor</div>
                </div>
            </div>`;
    });

    html += `
        <div class="etiqueta">
            <div style="width:33%; line-height:1.1;">
                <small>DESTINO:</small><br><b style="font-size:15px;">${g.d_n}</b><br>
                <span style="font-size:12px;">${g.d_d}</span><br><b class="resaltado" style="font-size:15px;">${g.d_l}</b>
            </div>
            <div style="width:33%; display:flex; flex-direction:column; align-items:center;">
                <div id="qr_etiqueta" style="width:70px; height:70px;"></div>
                <b style="font-size:14px; margin-top:3px;">${g.num}</b>
                ${g.retiro_asociado ? `<small>${g.retiro_asociado}</small>` : ''}
            </div>
            <div style="width:33%; text-align:right; line-height:1.1;">
                <small>ORIGEN:</small><br><b style="font-size:13px;">${g.r_n}</b><br>
                <b class="resaltado">${g.r_l}</b><br>
                <div class="bultos-box">BULTOS: ${g.cant_t}</div>
            </div>
        </div>`;

    document.getElementById('seccion-impresion').innerHTML = html;
    setTimeout(() => {
        const qrEl = document.getElementById("qr_etiqueta");
        if (qrEl && typeof QRCode !== 'undefined') new QRCode(qrEl, { text: g.num, width: 70, height: 70 });
        window.print();
    }, 300);
}

// ============================================
// HISTORIAL DE GUÍAS Y ACTUALIZACIONES EN NUBE
// ============================================
window.cambiarFiltroEstado = (est, btn) => {
    window.filtroEstadoActual = est;
    document.querySelectorAll('.btn-f').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderHistorial();
};

window.asignarRepartidor = async (firebaseID, repartidor) => {
    try {
        await update(ref(db, `moulin/guias/${firebaseID}`), { asignado_a: repartidor });
    } catch (e) {
        console.error("Error al asignar repartidor:", e);
    }
};

window.actualizarEstadoNube = async (firebaseID, nuevoEstado) => {
    try {
        await update(ref(db, `moulin/guias/${firebaseID}`), { estado: nuevoEstado });
    } catch (e) {
        console.error("Error al actualizar estado:", e);
    }
};

window.renderHistorial = () => {
    const busq = (document.getElementById('busq')?.value || '').toLowerCase();
    const fDesde = document.getElementById('f_desde')?.value || '';
    const fHasta = document.getElementById('f_hasta')?.value || '';
    const locElegida = (document.getElementById('f_localidad')?.value || "TODAS").toUpperCase();
    const tipoFiltro = document.getElementById('select-tipo-filtro')?.value || 'todo';

    const filtrados = window.historialGlobal.filter(g => {
        const sucPermitida = ES_ADMIN || (PREFIJO === "RECON" ? (g.num?.startsWith("RECON") || g.num?.startsWith("REC")) : g.num?.startsWith(PREFIJO));
        const est = (window.filtroEstadoActual === 'todos' || g.estado === window.filtroEstadoActual);
        
        let cumpleLocalidad = true;
        if (locElegida !== "TODAS") {
            const esDestino = g.d_l && g.d_l.toUpperCase().includes(locElegida);
            const esOrigen = g.r_l && g.r_l.toUpperCase().includes(locElegida);

            if (tipoFiltro === 'destino') cumpleLocalidad = esDestino;
            else if (tipoFiltro === 'origen') cumpleLocalidad = esOrigen;
            else cumpleLocalidad = esDestino || esOrigen;
        }

        let fec = true;
        if (fDesde || fHasta) {
            const p = (g.fecha || '').split('/');
            if (p.length === 3) {
                const fGuia = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                if (fDesde && fGuia < fDesde) fec = false;
                if (fHasta && fGuia > fHasta) fec = false;
            }
        }
        const b = (g.num || '').toLowerCase().includes(busq) || (g.r_n || '').toLowerCase().includes(busq) || (g.d_n || '').toLowerCase().includes(busq) || (g.retiro_asociado || '').toLowerCase().includes(busq);
        
        return sucPermitida && est && cumpleLocalidad && fec && b;
    });

    window.datosParaExcel = filtrados;

    const listaHistorialElem = document.getElementById('listaHistorial');
    if (listaHistorialElem) {
        listaHistorialElem.innerHTML = filtrados.slice(0, 50).map(g => `
        <tr>
            <td><b>${g.num || ''}</b></td>
            <td><small>${g.retiro_asociado || '-'}</small></td>
            <td>${g.fecha || ''}</td>
            <td>${g.r_n || ''} > ${g.d_n || ''}</td>
            <td>$${Number(g.total || 0).toLocaleString('es-AR')}</td>
            <td>
                <select onchange="asignarRepartidor('${g.firebaseID}', this.value)" style="font-size:11px; padding:4px; border-radius:4px; border:1px solid #6b46c1;">
                    <option value="">-- Sin asignar --</option>
                    ${window.repartidoresGlobal.filter(r => r.activo !== false && !r.eliminado).map(r => `<option value="${r.nombre}" ${g.asignado_a === r.nombre ? 'selected' : ''}>${r.nombre}</option>`).join('')}
                </select>
            </td>
            <td>
                <select onchange="actualizarEstadoNube('${g.firebaseID}', this.value)" style="font-size:11px; background:${g.estado === 'entregado' ? '#d4edda' : g.estado === 'en_reparto' ? '#e9d8fd' : 'white'}">
                    <option value="recibido" ${g.estado === 'recibido' ? 'selected' : ''}>Recibido</option>
                    <option value="deposito" ${g.estado === 'deposito' ? 'selected' : ''}>Depósito</option>
                    <option value="en_reparto" ${g.estado === 'en_reparto' ? 'selected' : ''}>En Reparto</option>
                    <option value="entregado" ${g.estado === 'entregado' ? 'selected' : ''}>Entregado</option>
                </select>
            </td>
            <td><button onclick="reimprimir('${g.num}')" title="Reimprimir">🖨️</button></td>
        </tr>`).join('');
    }
};

// ============================================
// EXCEL Y REPORTE APAISADO (39 FILAS - 11PX)
// ============================================
window.descargarExcel = () => {
    if (!window.datosParaExcel || !window.datosParaExcel.length) {
        return alert("No hay datos para exportar.");
    }

    const selectLoc = document.getElementById('f_localidad');
    const localidadNombre = selectLoc ? selectLoc.options[selectLoc.selectedIndex].text : "Todas";

    const wb = XLSX.utils.book_new();
    const wsData = [
        [`Remitos con destino: ${localidadNombre}`],
        [],
        ['Fecha', 'Nº de Guía', 'Localidad Origen', 'Remitente', 'Destinatario', 'Pago', 'Condición', 'Total ($)']
    ];

    window.datosParaExcel.forEach(g => {
        let pagoCorto = g.pago_en || '';
        if (pagoCorto.toUpperCase().includes('ORIGEN')) pagoCorto = 'ORIGEN';
        if (pagoCorto.toUpperCase().includes('DESTINO')) pagoCorto = 'DESTINO';

        wsData.push([
            g.fecha || '',
            g.num || '',
            g.r_l || '',
            g.r_n || '',
            g.d_n || '',
            pagoCorto,
            g.condicion || '',
            Number(g.total || 0)
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{wch: 11}, {wch: 14}, {wch: 16}, {wch: 22}, {wch: 22}, {wch: 10}, {wch: 11}, {wch: 12}];
    ws['!pageSetup'] = { orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 };

    XLSX.utils.book_append_sheet(wb, ws, "Control de Caja");
    XLSX.writeFile(wb, `Control_Caja_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ============================================
// IMPRESIÓN APAISADA - 39 FILAS (11px legible)
// ============================================
window.imprimirHistorialApaisado = function() {
    const datosAImprimir = window.datosParaExcel; 

    if (!datosAImprimir || datosAImprimir.length === 0) {
        alert("⚠️ No hay datos en el historial para imprimir con este filtro.");
        return;
    }

    const filasHTML = datosAImprimir.map(g => `
        <tr>
            <td><b>${g.num || ''}</b></td>
            <td>${g.fecha || ''}</td>
            <td>${g.r_n || ''} > ${g.d_n || ''}</td>
            <td>$${Number(g.total || 0).toLocaleString('es-AR')}</td>
            <td>${g.asignado_a || '-'}</td>
        </tr>
    `).join('');

    const ventanaImpresion = window.open('', '_blank', 'width=1000,height=700');
    ventanaImpresion.document.write(`
        <html>
        <head>
            <title>Planilla de Auditoría - Moulin</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { font-family: Arial, sans-serif; font-size: 11px; color: #333; margin: 0; padding: 0; }
                h2 { text-align: center; margin: 0 0 5px 0; color: #1a4a7a; font-size: 14px; }
                p { text-align: center; margin: 0 0 10px 0; font-size: 11px; color: #666; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                th, td { 
                    padding: 5px 8px !important; 
                    height: 18px !important; 
                    max-height: 18px !important; 
                    border: 1px solid #bbb; 
                    font-size: 11px; 
                    overflow: hidden; 
                    white-space: nowrap; 
                    text-overflow: ellipsis; 
                    line-height: 1.2; 
                }
                th { background: #1a4a7a; color: white; font-weight: bold; }
            </style>
        </head>
        <body>
            <h2>TRANSPORTE MOULIN - CONTROL DE COBROS Y DEPÓSITO</h2>
            <p>Fecha de emisión: ${new Date().toLocaleDateString('es-AR')}</p>
            <table>
                <thead>
                    <tr>
                        <th style="width: 15%;">Guía</th>
                        <th style="width: 12%;">Fecha</th>
                        <th style="width: 48%;">Ruta (Origen > Destino)</th>
                        <th style="width: 12%;">Total</th>
                        <th style="width: 13%;">Repartidor</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>
            <script>
                window.onload = function() {
                    window.print();
                    window.close();
                }
            </script>
        </body>
        </html>
    `);
    ventanaImpresion.document.close();
};
