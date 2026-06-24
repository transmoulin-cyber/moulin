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
    // Usa el nombre del archivo actual para redirigir
    window.location.href = window.location.pathname.split('/').pop();
}

const PREFIJO_BASE = (sesion.prefijo || "RECON").toUpperCase();
const PREFIJO = (["TODO", "ADM", "REC"].includes(PREFIJO_BASE)) ? "RECON" : PREFIJO_BASE;
const NOMBRE_OP = sesion.nombre || "Operador";
const ES_ADMIN = ["TODO", "ADM"].includes(PREFIJO_BASE);
const NOMBRE_SUCURSAL = PREFIJO_BASE; // Nombre de la sucursal actual

const PRECIOS_BASE = { "Bulto": 20000, "Pallet": 200000, "Sobre": 17000, "Caja": 20000 };

// ============================================
// ESTADO GLOBAL
// ============================================
window.historialGlobal = [];
window.clientesGlobal = [];
window.retirosGlobal = [];
window.filtroEstadoActual = 'todos';
window.datosParaExcel = [];
let proximoNumero = 1001;
let proximoRetiro = 1;
let retiroAsociadoActual = null; // Guarda el retiro que se está convirtiendo en guía

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
    window.clientesGlobal = data ? Object.values(data) : [];

    const listaDL = document.getElementById('lista_clientes');
    if (listaDL) {
        listaDL.innerHTML = window.clientesGlobal
            .filter(c => c.nombre || c.n)
            .map(c => `<option value="${c.nombre || c.n}">`)
            .join('');
    }

    const badge = document.getElementById('badge-clientes');
    if (badge) badge.innerText = window.clientesGlobal.length;

    renderTablaClientes();
});

// --- RETIROS ---
onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    window.retirosGlobal = data
        ? Object.entries(data).map(([id, val]) => ({ ...val, firebaseID: id })).reverse()
        : [];

    // Calcular próximo número de retiro
    const numsRetiro = window.retirosGlobal
        .map(r => {
            if (!r.num_retiro) return 0;
            const partes = r.num_retiro.split('-');
            return partes.length >= 3 ? parseInt(partes[2]) || 0 : 0;
        })
        .filter(n => !isNaN(n));
    proximoRetiro = numsRetiro.length > 0 ? Math.max(...numsRetiro) + 1 : 1;

    // Badge de pendientes visibles para esta sucursal
    const pendientesVisibles = window.retirosGlobal.filter(r =>
        r.estado === 'pendiente' && puedeVerRetiro(r)
    );
    const badge = document.getElementById('badge-retiros');
    if (badge) {
        badge.innerText = pendientesVisibles.length;
        badge.style.display = pendientesVisibles.length > 0 ? "inline-block" : "none";
    }

    renderRetiros();
});

// ============================================
// PERMISOS DE VISIBILIDAD DE RETIROS
// ============================================
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
    const n = document.getElementById(`${tipo}_n`).value.trim();
    const cliente = window.clientesGlobal.find(c =>
        (c.nombre || c.n || '').toLowerCase() === n.toLowerCase()
    );
    if (cliente) {
        document.getElementById(`${tipo}_d`).value = cliente.direccion || cliente.d || '';
        document.getElementById(`${tipo}_l`).value = cliente.localidad || cliente.l || '';
        document.getElementById(`${tipo}_t`).value = cliente.telefono || cliente.t || '';
        document.getElementById(`${tipo}_cbu`).value = cliente.cbu || cliente.alias || '';
    }
};

// ============================================
// FILTRO DINÁMICO DE LOCALIDADES
// ============================================
window.actualizarFiltroLocalidades = function () {
    const localidades = new Set();
    window.historialGlobal.forEach(g => {
        if (g.d_l) localidades.add(g.d_l.trim().toUpperCase());
        if (g.r_l) localidades.add(g.r_l.trim().toUpperCase());
    });
    const select = document.getElementById('f_localidad');
    const valorActual = select.value;
    const sorted = Array.from(localidades).sort();
    select.innerHTML = '<option value="TODAS">-- Todas las localidades --</option>' +
        sorted.map(l => `<option value="${l}">${l}</option>`).join('');
    if (sorted.includes(valorActual)) select.value = valorActual;
};

// ============================================
// TABLA DE ÍTEMS
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
        <td><button onclick="this.parentElement.parentElement.remove(); calcularTotales();">✕</button></td>`;
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

// ============================================
// EMISIÓN DE GUÍA
// ============================================
const btnEmitir = document.getElementById('btn-emitir');
if (btnEmitir) {
    btnEmitir.onclick = async () => {
        const r_n = document.getElementById('r_n').value.trim();
        const d_n = document.getElementById('d_n').value.trim();
        if (!r_n || !d_n) return alert("⚠️ Faltan datos de clientes.");

        const tot = calcularTotales();
        if (tot.cant_t === 0) return alert("⚠️ Debes agregar al menos un bulto.");

        const idU = Date.now();
        const nroGuia = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;

        const guia = {
            num: nroGuia,
            fecha: new Date().toLocaleDateString('es-AR'),
            timestamp: Date.now(),
            r_n, r_d: document.getElementById('r_d').value, r_l: document.getElementById('r_l').value,
            r_t: document.getElementById('r_t').value, r_cbu: document.getElementById('r_cbu').value,
            d_n, d_d: document.getElementById('d_d').value, d_l: document.getElementById('d_l').value,
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

            // Si viene de un retiro, marcarlo como realizado
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
            alert("❌ Error al guardar: " + e.message);
        }
    };
}

window.limpiarFormulario = function () {
    ['r_n', 'r_t', 'r_d', 'r_l', 'r_cbu', 'd_n', 'd_t', 'd_d', 'd_l', 'd_cbu', 'cr_monto'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('cuerpoItems').innerHTML = '';
    retiroAsociadoActual = null;
    document.getElementById('aviso-retiro').style.display = 'none';
    agregarFila();
};

// ============================================
// IMPRESIÓN
// ============================================
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
                    <div style="text-align:right;">Flete: $${g.flete} | Seg: $${g.seg} | <span style="font-size:18px;">TOTAL: $${g.total}</span></div>
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
// HISTORIAL DE GUÍAS
// ============================================
window.cambiarFiltroEstado = (est, btn) => {
    window.filtroEstadoActual = est;
    document.querySelectorAll('.btn-f').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderHistorial();
};

window.renderHistorial = () => {
    const busq = (document.getElementById('busq')?.value || '').toLowerCase();
    const fDesde = document.getElementById('f_desde')?.value || '';
    const fHasta = document.getElementById('f_hasta')?.value || '';
    const locElegida = document.getElementById('f_localidad')?.value || "TODAS";

    const filtrados = window.historialGlobal.filter(g => {
        const sucPermitida = ES_ADMIN || (PREFIJO === "RECON" ? (g.num?.startsWith("RECON") || g.num?.startsWith("REC")) : g.num?.startsWith(PREFIJO));
        const est = (window.filtroEstadoActual === 'todos' || g.estado === window.filtroEstadoActual);
        const cumpleLocalidad = (locElegida === "TODAS") || (g.d_l && g.d_l.toUpperCase().includes(locElegida)) || (g.r_l && g.r_l.toUpperCase().includes(locElegida));
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
document.getElementById('listaHistorial').innerHTML = filtrados.slice(0, 50).map(g => `
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
};

window.actualizarEstadoNube = (id, est) => {
    update(ref(db, `moulin/guias/${id}`), { estado: est }).catch(err => alert("Error: " + err.message));
};
window.asignarRepartidor = async (guiaID, nombreRepartidor) => {
    try {
        await update(ref(db, `moulin/guias/${guiaID}`), { 
            asignado_a: nombreRepartidor || null,
            fecha_asignacion: nombreRepartidor ? new Date().toLocaleString('es-AR') : null,
            asignado_por: NOMBRE_OP
        });
        
        // Si se asignó un repartidor, cambiar estado a "en_reparto" automáticamente
        if (nombreRepartidor) {
            await update(ref(db, `moulin/guias/${guiaID}`), { estado: 'en_reparto' });
        }
    } catch (e) {
        alert("Error al asignar: " + e.message);
    }
};
window.reimprimir = (num) => {
    const g = window.historialGlobal.find(x => x.num === num);
    if (g) imprimir(g); else alert("Guía no encontrada.");
};

// ============================================
// EXCEL GUÍAS
// ============================================
window.descargarExcel = () => {
    if (!window.datosParaExcel.length) return alert("No hay datos para exportar.");
    const resumen = window.datosParaExcel.map(g => ({
        'N° Guía': g.num, 'Retiro Asociado': g.retiro_asociado || '', 'Fecha': g.fecha,
        'Remitente': g.r_n, 'Tel. Remitente': g.r_t, 'Dirección Origen': g.r_d, 'Localidad Origen': g.r_l,
        'Destinatario': g.d_n, 'Tel. Destinatario': g.d_t, 'Dirección Destino': g.d_d, 'Localidad Destino': g.d_l,
        'Cant. Bultos': g.cant_t, 'Flete': Number(g.flete || 0), 'Seguro': Number(g.seg || 0),
        'TOTAL': Number(g.total || 0), 'Pago en': g.pago_en, 'Condición': g.condicion,
        'Estado': g.estado?.toUpperCase() || '', 'Operador': g.emisor || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(resumen);
    ws['!cols'] = [{wch:15},{wch:15},{wch:12},{wch:25},{wch:15},{wch:30},{wch:20},{wch:25},{wch:15},{wch:30},{wch:20},{wch:10},{wch:12},{wch:12},{wch:12},{wch:18},{wch:12},{wch:12},{wch:15}];
    XLSX.utils.book_append_sheet(wb, ws, "Guías");
    XLSX.writeFile(wb, `Moulin_Guias_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ============================================
// RETIROS - FORMULARIO
// ============================================
window.toggleFormRetiro = function () {
    const form = document.getElementById('form-retiro-container');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'none') {
        ['ret_cliente', 'ret_direccion', 'ret_telefono', 'ret_localidad', 'ret_pedido_por', 'ret_observaciones'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('ret_bultos').value = '1';
    }
};

window.guardarRetiro = async function () {
    const cliente = document.getElementById('ret_cliente').value.trim();
    const localidad = document.getElementById('ret_localidad').value.trim().toUpperCase();
    const pedidoPor = document.getElementById('ret_pedido_por').value.trim().toUpperCase();

    if (!cliente) return alert("⚠️ Ingresá el nombre del local/persona.");
    if (!localidad) return alert("⚠️ Ingresá la localidad donde se retira.");

    // Abreviatura de la localidad para el número
    const abrev = localidad.substring(0, 3);
    const numRetiro = `RT-${abrev}-${String(proximoRetiro).padStart(5, '0')}`;

    const retiro = {
        num_retiro: numRetiro,
        cliente: cliente,
        direccion: document.getElementById('ret_direccion').value.trim(),
        telefono: document.getElementById('ret_telefono').value.trim(),
        localidad: localidad,
        pedido_por: pedidoPor,
        bultos: parseInt(document.getElementById('ret_bultos').value) || 1,
        observaciones: document.getElementById('ret_observaciones').value.trim(),
        estado: 'pendiente',
        creadoPor: NOMBRE_OP,
        sucursalCreadora: NOMBRE_SUCURSAL,
        fechaCreacion: new Date().toLocaleDateString('es-AR'),
        timestamp: Date.now()
    };

    try {
        await set(ref(db, `moulin/retiros/${Date.now()}`), retiro);
        toggleFormRetiro();
        proximoRetiro++;
    } catch (e) {
        alert("❌ Error al guardar retiro: " + e.message);
    }
};

// ============================================
// RETIROS - RENDERIZADO
// ============================================
function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if (!div) return;

    const filtroEstado = document.getElementById('filtro_ret_estado')?.value || 'pendiente';
    const busq = (document.getElementById('busq_retiro')?.value || '').toLowerCase();

    const visibles = window.retirosGlobal.filter(r => {
        if (!puedeVerRetiro(r)) return false;
        if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false;
        if (busq) {
            const texto = `${r.num_retiro} ${r.cliente} ${r.localidad} ${r.pedido_por} ${r.observaciones}`.toLowerCase();
            if (!texto.includes(busq)) return false;
        }
        return true;
    });

    document.getElementById('contador-retiros').innerText = `${visibles.length} retiros`;

    if (visibles.length === 0) {
        div.innerHTML = `<p style="text-align:center; color:#666; padding:40px;">No hay retiros ${filtroEstado === 'pendiente' ? 'pendientes' : filtroEstado === 'realizado' ? 'realizados' : ''} para mostrar.</p>`;
        return;
    }

    div.innerHTML = visibles.map(r => {
        const claseEstado = r.estado === 'realizado' ? 'realizado' : r.estado === 'cancelado' ? 'cancelado' : '';
        const iconoEstado = r.estado === 'realizado' ? '✅' : r.estado === 'cancelado' ? '❌' : '🔶';
        const infoGuia = r.guiaAsociada ? `<br>📄 Guía: <b>${r.guiaAsociada}</b>` : '';

// Generar opciones de repartidores
const opcionesRep = window.repartidoresGlobal
    .filter(rep => rep.activo !== false && !rep.eliminado)
    .map(rep => `<option value="${rep.nombre}" ${r.asignado_a === rep.nombre ? 'selected' : ''}>${rep.nombre}</option>`)
    .join('');

let botones = '';
if (r.estado === 'pendiente') {
    botones = `
        <select onchange="asignarRepartidorRetiro('${r.firebaseID}', this.value)" style="font-size:11px; padding:6px; border-radius:4px; border:1px solid #6b46c1; margin-bottom:5px; width:100%;">
            <option value="">🏍️ Asignar repartidor...</option>
            ${opcionesRep}
        </select>
        <button class="btn-guia" onclick="pasarRetiroAGuia('${r.firebaseID}')">📦 Realizar Guía</button>
        <button class="btn-cancelar" onclick="cancelarRetiro('${r.firebaseID}')">✕ Cancelar</button>`;
} else {
    botones = `<button class="btn-ver" onclick="verRetiro('${r.firebaseID}')">👁️ Ver</button>`;
}
        return `
            <div class="card-retiro ${claseEstado}">
                <div class="retiro-info">
                    <div class="retiro-num">${iconoEstado} ${r.num_retiro}</div>
                    <div class="retiro-cliente">${r.cliente || 'Sin nombre'}</div>
                    <div class="retiro-datos">
                        📍 ${r.direccion || ''} — <b>${r.localidad || ''}</b><br>
                        📞 ${r.telefono || '-'} | 📦 ${r.bultos || '?'} bultos
                        ${r.observaciones ? `<br>📝 ${r.observaciones}` : ''}
                    </div>
                    <div class="retiro-meta">
                        Pedido por: <b>${r.pedido_por || '-'}</b> | Creado: ${r.fechaCreacion || ''} por ${r.creadoPor || ''}
                        ${infoGuia}
                    </div>
                </div>
                <div class="retiro-acciones">${botones}</div>
            </div>`;
    }).join('');
}

// ============================================
// RETIROS - ACCIONES
// ============================================
window.pasarRetiroAGuia = (firebaseID) => {
    const r = window.retirosGlobal.find(x => x.firebaseID === firebaseID);
    if (!r) return;

    // Guardar el número de retiro asociado
    retiroAsociadoActual = r.num_retiro;

    // Llenar el formulario de REMITENTE con los datos del retiro
    document.getElementById('r_n').value = r.cliente || '';
    document.getElementById('r_d').value = r.direccion || '';
    document.getElementById('r_l').value = r.localidad || '';
    document.getElementById('r_t').value = r.telefono || '';

    // Llenar el DESTINATARIO con la sucursal que pidió (si existe)
    if (r.pedido_por) {
        document.getElementById('d_l').value = r.pedido_por;
    }

    // Mostrar aviso
    document.getElementById('aviso-retiro').style.display = 'flex';
    document.getElementById('retiro-asociado-num').innerText = r.num_retiro;

    // Cambiar al tab de guías
    document.getElementById('btn-guia').click();
};

window.cancelarRetiroAsociado = function () {
    retiroAsociadoActual = null;
    document.getElementById('aviso-retiro').style.display = 'none';
};

window.cancelarRetiro = async (firebaseID) => {
    if (!confirm("¿Estás seguro de cancelar este retiro?")) return;
    try {
        await update(ref(db, `moulin/retiros/${firebaseID}`), {
            estado: 'cancelado',
            canceladoPor: NOMBRE_OP,
            fechaCancelado: new Date().toLocaleDateString('es-AR')
        });
    } catch (e) {
        alert("Error al cancelar: " + e.message);
    }
};

window.verRetiro = (firebaseID) => {
    const r = window.retirosGlobal.find(x => x.firebaseID === firebaseID);
    if (!r) return;
    alert(`Retiro: ${r.num_retiro}\nCliente: ${r.cliente}\nDirección: ${r.direccion}\nLocalidad: ${r.localidad}\nTel: ${r.telefono}\nBultos: ${r.bultos}\nEstado: ${r.estado}\nPedido por: ${r.pedido_por}\nCreado: ${r.fechaCreacion} por ${r.creadoPor}\nObservaciones: ${r.observaciones || '-'}${r.guiaAsociada ? '\nGuía: ' + r.guiaAsociada : ''}`);
};
window.asignarRepartidorRetiro = async (retiroID, nombreRepartidor) => {
    try {
        await update(ref(db, `moulin/retiros/${retiroID}`), { 
            asignado_a: nombreRepartidor || null,
            fecha_asignacion: nombreRepartidor ? new Date().toLocaleString('es-AR') : null,
            asignado_por: NOMBRE_OP
        });
    } catch (e) {
        alert("Error al asignar: " + e.message);
    }
};
// ============================================
// RETIROS - EXCEL
// ============================================
window.exportarRetirosExcel = () => {
    const filtroEstado = document.getElementById('filtro_ret_estado')?.value || 'pendiente';
    const visibles = window.retirosGlobal.filter(r => {
        if (!puedeVerRetiro(r)) return false;
        if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false;
        return true;
    });

    if (!visibles.length) return alert("No hay retiros para exportar.");

    const data = visibles.map(r => ({
        'N° Retiro': r.num_retiro,
        'Cliente': r.cliente,
        'Dirección': r.direccion,
        'Localidad': r.localidad,
        'Teléfono': r.telefono,
        'Bultos': r.bultos,
        'Pedido por': r.pedido_por,
        'Observaciones': r.observaciones || '',
        'Estado': r.estado?.toUpperCase() || '',
        'Creado por': r.creadoPor || '',
        'Fecha Creación': r.fechaCreacion || '',
        'Guía Asociada': r.guiaAsociada || '',
        'Realizado por': r.realizadoPor || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch:18},{wch:25},{wch:30},{wch:18},{wch:15},{wch:8},{wch:18},{wch:30},{wch:12},{wch:18},{wch:14},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws, "Retiros");
    XLSX.writeFile(wb, `Moulin_Retiros_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ============================================
// CUENTA CORRIENTE
// ============================================
function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if (!tbody) return;

    const deudaPorCliente = {};
    window.historialGlobal.forEach(g => {
        if (g.condicion === 'CTA CTE') {
            const cliente = g.pago_en === 'PAGO EN ORIGEN' ? g.r_n : g.d_n;
            if (!deudaPorCliente[cliente]) {
                deudaPorCliente[cliente] = { guias: 0, total: 0, localidad: g.r_l || g.d_l || '' };
            }
            deudaPorCliente[cliente].guias++;
            deudaPorCliente[cliente].total += Number(g.total || 0);
        }
    });

    const clientesConDeuda = Object.entries(deudaPorCliente)
        .map(([nombre, data]) => ({ nombre, ...data }))
        .sort((a, b) => b.total - a.total);

    tbody.innerHTML = clientesConDeuda.slice(0, 50).map(c => `
        <tr>
            <td><b>${c.nombre}</b></td>
            <td>${c.localidad}</td>
            <td>${c.guias}</td>
            <td style="color:var(--rojo); font-weight:bold;">$${c.total.toLocaleString('es-AR')}</td>
            <td><button onclick="verDetalleCliente('${c.nombre}')" style="background:var(--azul); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Ver Detalle</button></td>
        </tr>`).join('');
}

window.verDetalleCliente = (nombre) => {
    const guiasCliente = window.historialGlobal.filter(g =>
        g.condicion === 'CTA CTE' && (g.r_n === nombre || g.d_n === nombre)
    );
    let html = `<h3>Cuenta Corriente: ${nombre}</h3>
        <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a4a7a;color:white;">
        <th style="padding:8px;">Guía</th><th style="padding:8px;">Fecha</th><th style="padding:8px;">Ruta</th><th style="padding:8px;">Total</th><th style="padding:8px;">Estado</th></tr></thead><tbody>`;
    guiasCliente.forEach(g => {
        html += `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${g.num}</td><td style="padding:6px;border-bottom:1px solid #eee;">${g.fecha}</td><td style="padding:6px;border-bottom:1px solid #eee;">${g.r_l} → ${g.d_l}</td><td style="padding:6px;border-bottom:1px solid #eee;">$${Number(g.total).toLocaleString('es-AR')}</td><td style="padding:6px;border-bottom:1px solid #eee;">${g.estado}</td></tr>`;
    });
    html += '</tbody></table>';
    const win = window.open('', '_blank');
    win.document.write(`<html><head><style>body{font-family:Arial;padding:20px;}</style></head><body>${html}</body></html>`);
    win.document.close();
};
// ============================================
// REPARTIDORES
// ============================================
window.repartidoresGlobal = [];

// Listener de repartidores
onValue(ref(db, 'moulin/repartidores'), (snapshot) => {
    const data = snapshot.val();
    const todos = data ? Object.entries(data).map(([id, val]) => ({ ...val, firebaseID: id })) : [];
    
    // Filtrar por sucursal (salvo admin)
    window.repartidoresGlobal = ES_ADMIN 
        ? todos 
        : todos.filter(r => (r.sucursal || '').toUpperCase() === NOMBRE_SUCURSAL);
    
    const badge = document.getElementById('badge-repartidores');
    if (badge) badge.innerText = window.repartidoresGlobal.filter(r => r.activo !== false).length;
    
    renderRepartidores();
    renderStatsRepartidores();
});

window.toggleFormRepartidor = function (editandoID = null) {
    const form = document.getElementById('form-repartidor-container');
    const titulo = document.getElementById('form-rep-titulo');
    const isVisible = form.style.display === 'block';
    
    form.style.display = isVisible ? 'none' : 'block';
    
    // Mostrar/ocultar selector de sucursal según sea admin
    const selectSucursal = document.getElementById('rep_sucursal');
    const labelSucursal = document.getElementById('label-sucursal-rep');
    if (ES_ADMIN) {
        selectSucursal.style.display = 'block';
        labelSucursal.style.display = 'block';
    } else {
        selectSucursal.style.display = 'none';
        labelSucursal.style.display = 'none';
    }
    
    if (!isVisible && editandoID) {
        // Modo edición
        const rep = window.repartidoresGlobal.find(r => r.firebaseID === editandoID);
        if (rep) {
            titulo.innerText = `Editar Repartidor: ${rep.nombre}`;
            document.getElementById('rep_editando_id').value = editandoID;
            document.getElementById('rep_nombre').value = rep.nombre || '';
            document.getElementById('rep_telefono').value = rep.telefono || '';
            document.getElementById('rep_vehiculo').value = rep.vehiculo || '';
            document.getElementById('rep_pin').value = rep.pin || '';
            document.getElementById('rep_activo').value = (rep.activo !== false).toString();
            if (ES_ADMIN) {
                document.getElementById('rep_sucursal').value = rep.sucursal || 'RECON';
            }
        }
    } else if (!isVisible) {
        // Modo nuevo
        titulo.innerText = 'Nuevo Repartidor';
        document.getElementById('rep_editando_id').value = '';
        ['rep_nombre', 'rep_telefono', 'rep_vehiculo', 'rep_pin'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('rep_activo').value = 'true';
        if (ES_ADMIN) {
            document.getElementById('rep_sucursal').value = 'RECON'; // Valor por defecto
        }
    } else {
        // Cerrando
        document.getElementById('rep_editando_id').value = '';
    }
};

window.guardarRepartidor = async function () {
    const nombre = document.getElementById('rep_nombre').value.trim();
    const pin = document.getElementById('rep_pin').value.trim();
    
    if (!nombre) return alert("⚠️ Ingresá el nombre del repartidor.");
    if (!/^\d{4}$/.test(pin)) return alert("⚠️ El PIN debe tener 4 dígitos numéricos.");
    
    const editandoID = document.getElementById('rep_editando_id').value;
    
    const datos = {
        nombre: nombre,
        telefono: document.getElementById('rep_telefono').value.trim(),
        vehiculo: document.getElementById('rep_vehiculo').value.trim(),
        pin: pin,
        activo: document.getElementById('rep_activo').value === 'true',
        sucursal: NOMBRE_SUCURSAL,
        timestamp: Date.now()
    };
    
    try {
        if (editandoID) {
            // Editar
            await update(ref(db, `moulin/repartidores/${editandoID}`), datos);
        } else {
            // Crear nuevo
            datos.creadoPor = NOMBRE_OP;
            datos.fechaCreacion = new Date().toLocaleDateString('es-AR');
            await set(ref(db, `moulin/repartidores/${Date.now()}`), datos);
        }
        toggleFormRepartidor();
    } catch (e) {
        alert("❌ Error al guardar: " + e.message);
    }
};

window.eliminarRepartidor = async (firebaseID) => {
    const rep = window.repartidoresGlobal.find(r => r.firebaseID === firebaseID);
    if (!rep) return;
    if (!confirm(`¿Eliminar definitivamente a ${rep.nombre}?`)) return;
    
    try {
        // Usamos update con null para "borrar" (Firebase no permite delete real vía web)
        await update(ref(db, `moulin/repartidores/${firebaseID}`), { activo: false, eliminado: true });
    } catch (e) {
        alert("Error al eliminar: " + e.message);
    }
};

window.toggleActivoRepartidor = async (firebaseID) => {
    const rep = window.repartidoresGlobal.find(r => r.firebaseID === firebaseID);
    if (!rep) return;
    
    try {
        await update(ref(db, `moulin/repartidores/${firebaseID}`), { 
            activo: !(rep.activo !== false) 
        });
    } catch (e) {
        alert("Error al cambiar estado: " + e.message);
    }
};

function renderRepartidores() {
    const div = document.getElementById('listaRepartidores');
    if (!div) return;
    
    // Info sucursal
    const infoSuc = document.getElementById('info-sucursal-rep');
    if (infoSuc) infoSuc.innerText = NOMBRE_SUCURSAL;
    
    const activos = window.repartidoresGlobal.filter(r => r.activo !== false && !r.eliminado);
    const inactivos = window.repartidoresGlobal.filter(r => r.activo === false && !r.eliminado);
    
    if (activos.length === 0 && inactivos.length === 0) {
        div.innerHTML = `<p style="text-align:center; color:#666; padding:30px;">
            No hay repartidores cargados.<br>
            <button onclick="toggleFormRepartidor()" style="margin-top:10px; background:var(--verde); color:white; border:none; padding:8px 16px; border-radius:5px; cursor:pointer;">+ Crear el primero</button>
        </p>`;
        return;
    }
    
    let html = '';
    
    if (activos.length > 0) {
        html += `<h5 style="color:var(--verde); margin-top:10px;">✅ Activos (${activos.length})</h5>`;
        html += activos.map(r => renderCardRepartidor(r, true)).join('');
    }
    
    if (inactivos.length > 0) {
        html += `<h5 style="color:#999; margin-top:15px;">❌ Inactivos (${inactivos.length})</h5>`;
        html += inactivos.map(r => renderCardRepartidor(r, false)).join('');
    }
    
    div.innerHTML = html;
}

function renderCardRepartidor(r, activo) {
    // Contar guías asignadas en reparto a este repartidor
    const enReparto = window.historialGlobal.filter(g => 
        g.asignado_a === r.nombre && g.estado === 'en_reparto'
    ).length;
    
    const entregadas = window.historialGlobal.filter(g => 
        g.asignado_a === r.nombre && g.estado === 'entregado'
    ).length;
    
    return `
        <div class="card-repartidor ${activo ? '' : 'inactivo'}">
            <div class="repartidor-info">
                <div class="rep-nombre">🏍️ ${r.nombre}</div>
                <div class="rep-datos">
                    ${r.telefono ? `📞 ${r.telefono}` : ''} 
                    ${r.vehiculo ? `| 🚗 ${r.vehiculo}` : ''}
                    ${enReparto > 0 ? `<br><span style="color:#6b46c1; font-weight:bold;">📦 ${enReparto} en reparto ahora</span>` : ''}
                    ${entregadas > 0 ? ` | ✅ ${entregadas} entregadas` : ''}
                </div>
                <div class="rep-pin">PIN: ${r.pin || '----'}</div>
            </div>
            <div class="repartidor-acciones">
                <button class="btn-editar-rep" onclick="toggleFormRepartidor('${r.firebaseID}')">✏️ Editar</button>
                <button class="btn-desactivar-rep" onclick="toggleActivoRepartidor('${r.firebaseID}')">
                    ${activo ? '⏸️ Desactivar' : '▶️ Activar'}
                </button>
                <button class="btn-eliminar-rep" onclick="eliminarRepartidor('${r.firebaseID}')">🗑️</button>
            </div>
        </div>`;
}

function renderStatsRepartidores() {
    const div = document.getElementById('stats-repartidores');
    if (!div) return;
    
    const activos = window.repartidoresGlobal.filter(r => r.activo !== false && !r.eliminado).length;
    const enReparto = window.historialGlobal.filter(g => g.asignado_a && g.estado === 'en_reparto').length;
    const entregadasHoy = window.historialGlobal.filter(g => {
        if (!g.asignado_a || g.estado !== 'entregado') return false;
        return g.fecha === new Date().toLocaleDateString('es-AR');
    }).length;
    
    div.innerHTML = `
        <div class="caja" style="text-align:center;">
            <div style="font-size:28px; font-weight:bold; color:var(--verde);">${activos}</div>
            <small>Repartidores activos</small>
        </div>
        <div class="caja" style="text-align:center;">
            <div style="font-size:28px; font-weight:bold; color:#6b46c1;">${enReparto}</div>
            <small>En reparto ahora</small>
        </div>
        <div class="caja" style="text-align:center;">
            <div style="font-size:28px; font-weight:bold; color:var(--azul);">${entregadasHoy}</div>
            <small>Entregadas hoy</small>
        </div>
    `;
}
// ============================================
// INICIALIZACIÓN
// ============================================
window.onload = () => {
    if (document.getElementById('cuerpoItems') && !document.getElementById('cuerpoItems').innerHTML) {
        window.agregarFila();
    }
};

if (document.getElementById('add-item')) {
    document.getElementById('add-item').onclick = window.agregarFila;
}
