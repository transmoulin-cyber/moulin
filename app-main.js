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
    window.location.href = "test-retiros.html";
}

const PREFIJO_BASE = (sesion.prefijo || "RECON").toUpperCase();
const PREFIJO = (["TODO", "ADM", "REC"].includes(PREFIJO_BASE)) ? "RECON" : PREFIJO_BASE;
const NOMBRE_OP = sesion.nombre || "Operador";
const ES_ADMIN = ["TODO", "ADM"].includes(PREFIJO_BASE);

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

// ============================================
// LISTENERS FIREBASE
// ============================================
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
        console.error("Error en listener:", e);
    }
});

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

onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    window.retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})).reverse() : [];
    
    const badge = document.getElementById('badge-retiros');
    if (badge) {
        const pendientes = window.retirosGlobal.filter(r => r.estado !== "Realizado").length;
        badge.innerText = pendientes;
        badge.style.display = pendientes > 0 ? "inline-block" : "none";
    }
    
    renderRetiros();
});

// ============================================
// FILTRO DINÁMICO DE LOCALIDADES
// ============================================
window.actualizarFiltroLocalidades = function() {
    const localidades = new Set();
    window.historialGlobal.forEach(g => {
        if (g.d_l && typeof g.d_l === 'string') localidades.add(g.d_l.trim().toUpperCase());
        if (g.r_l && typeof g.r_l === 'string') localidades.add(g.r_l.trim().toUpperCase());
    });

    const select = document.getElementById('f_localidad');
    const valorActual = select.value;
    const sorted = Array.from(localidades).sort();
    
    select.innerHTML = '<option value="TODAS">-- Todas las localidades --</option>' +
        sorted.map(l => `<option value="${l}">${l}</option>`).join('');
    
    if (sorted.includes(valorActual)) {
        select.value = valorActual;
    } else {
        select.value = "TODAS";
    }
};

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
// TABS
// ============================================
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-tabs button, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
    };
});

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
        <td><button onclick="this.parentElement.parentElement.remove(); calcularTotales();">✕</button></td>
    `;
    
    cuerpoItems.appendChild(tr);
    calcularTotales();
};

window.actualizarPrecioXDefecto = (inputTipo) => {
    const tr = inputTipo.closest('tr');
    tr.querySelector('.i-unit').value = PRECIOS_BASE[inputTipo.value] || 0;
    calcularTotales();
};

window.calcularTotales = function() {
    let flete = 0, vdecl = 0, cant_t = 0;
    document.querySelectorAll('#cuerpoItems tr').forEach(r => {
        const c = parseFloat(r.querySelector('.i-cant').value) || 0;
        const u = parseFloat(r.querySelector('.i-unit').value) || 0;
        const d = parseFloat(r.querySelector('.i-decl').value) || 0;
        flete += c * u;
        vdecl += d;
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
        
        if (!r_n || !d_n) {
            alert("⚠️ Faltan datos de clientes (Remitente y Destinatario).");
            return;
        }

        const tot = calcularTotales();
        if (tot.cant_t === 0) {
            alert("⚠️ Debes agregar al menos un bulto.");
            return;
        }

        const idU = Date.now();
        const nroGuia = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;

        const guia = {
            num: nroGuia,
            fecha: new Date().toLocaleDateString('es-AR'),
            timestamp: Date.now(),
            r_n,
            r_d: document.getElementById('r_d').value,
            r_l: document.getElementById('r_l').value,
            r_t: document.getElementById('r_t').value,
            r_cbu: document.getElementById('r_cbu').value,
            d_n,
            d_d: document.getElementById('d_d').value,
            d_l: document.getElementById('d_l').value,
            d_t: document.getElementById('d_t').value,
            d_cbu: document.getElementById('d_cbu').value,
            flete: tot.flete.toFixed(2),
            seg: tot.seg.toFixed(2),
            total: tot.total.toFixed(2),
            v_decl: tot.v_decl.toFixed(2),
            cant_t: tot.cant_t,
            pago_en: document.getElementById('pago_en').value,
            condicion: document.getElementById('condicion').value,
            cr_activo: document.getElementById('cr_activo').value,
            cr_monto: document.getElementById('cr_monto').value || "0",
            p_seg_aplicado: document.getElementById('p_seg').value,
            estado: 'recibido',
            emisor: NOMBRE_OP,
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value,
                t: tr.querySelector('.i-tipo').value,
                d: tr.querySelector('.i-det').value,
                u: tr.querySelector('.i-unit').value,
                vd: tr.querySelector('.i-decl').value
            }))
        };

        try {
            await set(ref(db, `moulin/guias/${idU}`), guia);
            imprimir(guia);
            limpiarFormulario();
            proximoNumero++;
        } catch (e) {
            alert("❌ Error al guardar: " + e.message);
        }
    };
}

window.limpiarFormulario = function() {
    ['r_n', 'r_t', 'r_d', 'r_l', 'r_cbu', 'd_n', 'd_t', 'd_d', 'd_l', 'd_cbu', 'cr_monto'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('cuerpoItems').innerHTML = '';
    agregarFila();
};

// ============================================
// IMPRESIÓN
// ============================================
function imprimir(g) {
    const itemsH = (g.items || []).map(i => `
        <tr>
            <td align="center">${i.c}</td>
            <td>${i.t}</td>
            <td>${i.d || ''}</td>
            <td align="right">$${i.u}</td>
            <td align="right">$${i.vd}</td>
        </tr>`).join('');

    let html = "";
    const logoPath = "logo.png";
    const fallbackLogo = "https://raw.githubusercontent.com/fcanteros77/fcanteros77.github.io/main/logo.png";

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
                <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; margin:8px 0; padding:8px; line-height:1.4;">
                    <div style="border-right:1px solid #000; padding-right:8px;">
                        <b style="font-size:14px;">REMITENTE:</b> ${g.r_n}<br>
                        Dir: ${g.r_d}<br>
                        Tel: ${g.r_t} | CBU: ${g.r_cbu}<br>
                        Loc: <span class="resaltado">${g.r_l}</span>
                    </div>
                    <div style="padding-left:8px;">
                        <b style="font-size:14px;">DESTINATARIO:</b> ${g.d_n}<br>
                        Dir: ${g.d_d}<br>
                        Tel: ${g.d_t} | CBU: ${g.d_cbu}<br>
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
            </div>
        `;
    });

    html += `
        <div class="etiqueta">
            <div style="width:33%; line-height:1.1;">
                <small>DESTINO:</small><br>
                <b style="font-size:15px;">${g.d_n}</b><br>
                <span style="font-size:12px;">${g.d_d}</span><br>
                <b class="resaltado" style="font-size:15px;">${g.d_l}</b>
            </div>
            <div style="width:33%; display:flex; flex-direction:column; align-items:center;">
                <div id="qr_etiqueta" style="width:70px; height:70px;"></div>
                <b style="font-size:14px; margin-top:3px;">${g.num}</b>
            </div>
            <div style="width:33%; text-align:right; line-height:1.1;">
                <small>ORIGEN:</small><br>
                <b style="font-size:13px;">${g.r_n}</b><br>
                <b class="resaltado">${g.r_l}</b><br>
                <div class="bultos-box">BULTOS: ${g.cant_t}</div>
            </div>
        </div>
    `;

    document.getElementById('seccion-impresion').innerHTML = html;
    setTimeout(() => {
        const qrEl = document.getElementById("qr_etiqueta");
        if (qrEl && typeof QRCode !== 'undefined') {
            new QRCode(qrEl, { text: g.num, width: 70, height: 70 });
        }
        window.print();
    }, 300);
}

// ============================================
// FILTROS Y RENDERIZADO
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
        const sucPermitida = ES_ADMIN ||
            (PREFIJO === "RECON" ? (g.num?.startsWith("RECON") || g.num?.startsWith("REC")) : g.num?.startsWith(PREFIJO));

        const est = (window.filtroEstadoActual === 'todos' || g.estado === window.filtroEstadoActual);

        const cumpleLocalidad = (locElegida === "TODAS") ||
            (g.d_l && g.d_l.toUpperCase().includes(locElegida)) ||
            (g.r_l && g.r_l.toUpperCase().includes(locElegida));

        let fec = true;
        if (fDesde || fHasta) {
            const p = (g.fecha || '').split('/');
            if (p.length === 3) {
                const fGuia = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                if (fDesde && fGuia < fDesde) fec = false;
                if (fHasta && fGuia > fHasta) fec = false;
            }
        }

        const b = (g.num || '').toLowerCase().includes(busq) ||
            (g.r_n || '').toLowerCase().includes(busq) ||
            (g.d_n || '').toLowerCase().includes(busq);

        return sucPermitida && est && cumpleLocalidad && fec && b;
    });

    window.datosParaExcel = filtrados;

    document.getElementById('listaHistorial').innerHTML = filtrados.slice(0, 50).map(g => `
        <tr>
            <td><b>${g.num || ''}</b></td>
            <td>${g.fecha || ''}</td>
            <td>${g.r_n || ''} > ${g.d_n || ''}</td>
            <td>$${Number(g.total || 0).toLocaleString('es-AR')}</td>
            <td>
                <select onchange="actualizarEstadoNube('${g.firebaseID}', this.value)" style="font-size:11px; background:${g.estado === 'entregado' ? '#d4edda' : 'white'}">
                    <option value="recibido" ${g.estado === 'recibido' ? 'selected' : ''}>Recibido</option>
                    <option value="deposito" ${g.estado === 'deposito' ? 'selected' : ''}>Depósito</option>
                    <option value="entregado" ${g.estado === 'entregado' ? 'selected' : ''}>Entregado</option>
                </select>
            </td>
            <td><button onclick="reimprimir('${g.num}')" title="Reimprimir">🖨️</button></td>
        </tr>
    `).join('');
};

window.actualizarEstadoNube = (id, est) => {
    update(ref(db, `moulin/guias/${id}`), { estado: est })
        .catch(err => alert("Error al actualizar: " + err.message));
};

window.reimprimir = (num) => {
    const g = window.historialGlobal.find(x => x.num === num);
    if (g) imprimir(g);
    else alert("Guía no encontrada.");
};

// ============================================
// EXPORTAR EXCEL
// ============================================
window.descargarExcel = () => {
    if (!window.datosParaExcel.length) {
        alert("No hay datos para exportar con los filtros actuales.");
        return;
    }

    const resumen = window.datosParaExcel.map(g => ({
        'N° Guía': g.num,
        'Fecha': g.fecha,
        'Remitente': g.r_n,
        'Tel. Remitente': g.r_t,
        'Dirección Origen': g.r_d,
        'Localidad Origen': g.r_l,
        'Destinatario': g.d_n,
        'Tel. Destinatario': g.d_t,
        'Dirección Destino': g.d_d,
        'Localidad Destino': g.d_l,
        'Ruta': `${g.r_l || ''} → ${g.d_l || ''}`,
        'Cant. Bultos': g.cant_t,
        'Flete': Number(g.flete || 0),
        'Seguro': Number(g.seg || 0),
        'Valor Declarado': Number(g.v_decl || 0),
        'TOTAL': Number(g.total || 0),
        'Pago en': g.pago_en,
        'Condición': g.condicion,
        'Crédito': g.cr_activo === 'SI' ? `SI ($${g.cr_monto || 0})` : 'NO',
        'Estado': g.estado ? g.estado.toUpperCase() : '',
        'Operador': g.emisor || ''
    }));

    const detalle = [];
    window.datosParaExcel.forEach(g => {
        (g.items || []).forEach(item => {
            detalle.push({
                'N° Guía': g.num,
                'Fecha': g.fecha,
                'Destinatario': g.d_n,
                'Localidad Destino': g.d_l,
                'Cantidad': item.c,
                'Tipo': item.t,
                'Detalle': item.d,
                'Unitario': Number(item.u || 0),
                'Valor Declarado': Number(item.vd || 0)
            });
        });
    });

    const wb = XLSX.utils.book_new();
    
    const ws1 = XLSX.utils.json_to_sheet(resumen);
    ws1['!cols'] = [
        {wch: 15}, {wch: 12}, {wch: 25}, {wch: 15}, {wch: 30}, {wch: 20},
        {wch: 25}, {wch: 15}, {wch: 30}, {wch: 20}, {wch: 30}, {wch: 10},
        {wch: 12}, {wch: 12}, {wch: 15}, {wch: 12}, {wch: 18}, {wch: 12},
        {wch: 15}, {wch: 12}, {wch: 15}
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");

    if (detalle.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(detalle);
        ws2['!cols'] = [
            {wch: 15}, {wch: 12}, {wch: 25}, {wch: 20},
            {wch: 10}, {wch: 12}, {wch: 30}, {wch: 12}, {wch: 15}
        ];
        XLSX.utils.book_append_sheet(wb, ws2, "Detalle Bultos");
    }

    const fecha = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Moulin_Reporte_${fecha}.xlsx`);
};

// ============================================
// RETIROS
// ============================================
function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if (!div) return;
    
    const pendientes = window.retirosGlobal.filter(r => r.estado !== "Realizado");
    
    if (pendientes.length === 0) {
        div.innerHTML = '<p style="text-align:center; color:#666; padding:40px;">No hay retiros pendientes.</p>';
        return;
    }
    
    div.innerHTML = pendientes.map(r => `
        <div class="card-retiro">
            <div>
                <b>${r.cliente || r.n || 'Sin nombre'}</b><br>
                <small>${r.direccion || ''} (${r.localidad || ''})</small>
            </div>
            <button onclick="window.pasarRetiroAGuia('${r.id}')" style="background:var(--verde); color:white; border:none; padding:10px 15px; border-radius:5px; cursor:pointer;">USAR ➔</button>
        </div>
    `).join('');
}

window.pasarRetiroAGuia = (id) => {
    const r = window.retirosGlobal.find(x => x.id === id);
    if (!r) return;
    
    document.getElementById('r_n').value = r.cliente || r.n || "";
    document.getElementById('r_d').value = r.direccion || "";
    document.getElementById('r_l').value = r.localidad || "";
    document.getElementById('r_t').value = r.telefono || "";
    
    document.getElementById('btn-guia').click();
};

// ============================================
// CUENTA CORRIENTE
// ============================================
function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if (!tbody) return;
    
    // Calcular deuda por cliente
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
        </tr>
    `).join('');
}

window.verDetalleCliente = (nombre) => {
    const guiasCliente = window.historialGlobal.filter(g => 
        g.condicion === 'CTA CTE' && (g.r_n === nombre || g.d_n === nombre)
    );
    
    let html = `<h3>Detalle de Cuenta Corriente: ${nombre}</h3>`;
    html += '<table class="tabla-items"><thead><tr><th>Guía</th><th>Fecha</th><th>Ruta</th><th>Total</th><th>Estado</th></tr></thead><tbody>';
    
    guiasCliente.forEach(g => {
        html += `<tr>
            <td>${g.num}</td>
            <td>${g.fecha}</td>
            <td>${g.r_l} → ${g.d_l}</td>
            <td>$${Number(g.total).toLocaleString('es-AR')}</td>
            <td>${g.estado}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    
    const win = window.open('', '_blank');
    win.document.write(`<html><head><style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;}th{background:#1a4a7a;color:white;padding:8px;}td{padding:6px;border-bottom:1px solid #eee;}</style></head><body>${html}</body></html>`);
    win.document.close();
};

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
