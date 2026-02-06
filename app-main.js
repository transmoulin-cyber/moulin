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

// Recuperar sesión o usar valores por defecto
const sesion = JSON.parse(sessionStorage.getItem('moulin_sesion'));
const PREFIJO_BASE = sesion?.prefijo || "REC";
const PREFIJO = (["TODO","ADM","REC"].includes(PREFIJO_BASE)) ? "RECON" : PREFIJO_BASE;
const NOMBRE_OP = sesion?.nombre || "Operador";

// Variables Globales
let proximoNumero = 1001;
let historialGlobal = [];
let retirosGlobal = [];
window.clientesGlobales = []; 

// 2. ESCUCHAS DE FIREBASE (Datos en tiempo real)

// --- CLIENTES ---
onValue(ref(db, 'moulin/clientes'), (snapshot) => {
    const data = snapshot.val();
    window.clientesGlobales = data ? Object.values(data) : [];
    
    // 1. Llenar el <datalist> para autocompletado
    const listaDL = document.getElementById('lista_clientes');
    if(listaDL) {
        listaDL.innerHTML = window.clientesGlobales
            .filter(c => c.nombre || c.n)
            .map(c => `<option value="${c.nombre || c.n}">`)
            .join('');
    }

    // 2. Actualizar Badge (Contador)
    const badge = document.getElementById('badge-clientes');
    if(badge) badge.innerText = window.clientesGlobales.length;

    // 3. Renderizar tabla si estamos en la pestaña
    renderTablaClientes();
});

// --- RETIROS ---
onValue(ref(db, 'moulin/retiros'), (snapshot) => {
    const data = snapshot.val();
    retirosGlobal = data ? Object.entries(data).map(([id, val]) => ({...val, id})).reverse() : [];
    
    // 1. Actualizar Badge
    const badge = document.getElementById('badge-retiros');
    if(badge) {
        const pendientes = retirosGlobal.filter(r => r.estado !== "Realizado").length;
        badge.innerText = pendientes;
        badge.style.display = pendientes > 0 ? "inline-block" : "none";
    }

    // 2. Renderizar lista visual
    renderRetiros();
});

// --- GUÍAS (HISTORIAL) ---
onValue(ref(db, 'moulin/guias'), (snapshot) => {
    const data = snapshot.val();
    const todas = data ? Object.entries(data).map(([id, val]) => ({...val, firebaseID: id})).reverse() : [];
    
    // Filtrar según sucursal
    historialGlobal = (PREFIJO_BASE === "TODO" || PREFIJO_BASE === "ADM") ? todas : todas.filter(g => g.num.startsWith(PREFIJO));
    
    // Calcular próximo número
    const misGuias = todas.filter(g => g.num.startsWith(PREFIJO));
    if (misGuias.length > 0) {
        const nros = misGuias.map(g => parseInt(g.num.split('-')[1]) || 0);
        proximoNumero = Math.max(...nros) + 1;
    }

    // Mostrar número en pantalla
    const displayGuia = document.getElementById('display_guia');
    if (displayGuia) {
        displayGuia.innerText = `${PREFIJO}-${String(proximoNumero).padStart(5, '0')}`;
    }
    
    renderHistorial();
    renderTablaClientes(); // Actualizar botones de "Pendientes" en clientes
});

// 3. LOGICA DE INTERFAZ Y AUTOCOMPLETADO
const ejecutarAutocompletado = (idInput, prefijo) => {
    const input = document.getElementById(idInput);
    if (!input) return;
    
    input.addEventListener('change', (e) => {
        const val = e.target.value;
        const cliente = window.clientesGlobales.find(c => (c.nombre || c.n) === val);
        
        if (cliente) {
            // Mapeo flexible para soportar datos viejos y nuevos
            const datos = {
                d: cliente.direccion || cliente.d || '',
                l: cliente.localidad || cliente.l || '',
                t: cliente.telefono || cliente.t || '',
                cbu: cliente.cbu || cliente.alias || ''
            };
            
            if(document.getElementById(`${prefijo}_d`)) document.getElementById(`${prefijo}_d`).value = datos.d;
            if(document.getElementById(`${prefijo}_l`)) document.getElementById(`${prefijo}_l`).value = datos.l;
            if(document.getElementById(`${prefijo}_t`)) document.getElementById(`${prefijo}_t`).value = datos.t;
            if(document.getElementById(`${prefijo}_cbu`)) document.getElementById(`${prefijo}_cbu`).value = datos.cbu;
        }
    });
};

ejecutarAutocompletado('r_n', 'r');
ejecutarAutocompletado('d_n', 'd');

// 4. TABLA DE ÍTEMS Y CÁLCULOS
function agregarFila() {
    const cuerpoItems = document.getElementById('cuerpoItems');
    if (!cuerpoItems) return;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" class="i-cant" value="1" style="width:50px; text-align:center;"></td>
        <td><select class="i-tipo"><option>Bulto</option><option>Pallet</option><option>Sobre</option><option>Caja</option></select></td>
        <td><input type="text" class="i-det" placeholder="Descripción"></td>
        <td><input type="number" class="i-unit" value="18000"></td>
        <td><input type="number" class="i-decl" value="0"></td>
        <td><button class="btn-del" style="background:#ff4444; color:white; border:none; padding:5px 10px; cursor:pointer;">✕</button></td>
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
        let u = parseFloat(r.querySelector('.i-unit').value) || 0;
        let d = parseFloat(r.querySelector('.i-decl').value) || 0;
        
        flete += c * u;
        vdecl += d;
        cant_t += c;
    });

    let pSeg = parseFloat(document.getElementById('p_seg')?.value || 0.8);
    let seg = vdecl * (pSeg / 100);
    let total = flete + seg;

    const txt = document.getElementById('total_txt');
    if(txt) txt.innerText = `TOTAL: $ ${total.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
    
    return { flete, seg, total, v_decl: vdecl, cant_t };
}

// 5. EMISIÓN DE GUÍA (GUARDAR)
const btnEmitir = document.getElementById('btn-emitir');
if (btnEmitir) {
    btnEmitir.onclick = async () => {
        const r_n = document.getElementById('r_n').value.trim();
        const d_n = document.getElementById('d_n').value.trim();
        
        if(!r_n || !d_n) return alert("⚠️ Faltan datos del Remitente o Destinatario.");

        const tot = calcularTotales();
        const guia = {
            num: document.getElementById('display_guia').innerText,
            fecha: new Date().toLocaleDateString(),
            operador: NOMBRE_OP,
            // Remitente
            r_n, 
            r_d: document.getElementById('r_d').value, 
            r_l: document.getElementById('r_l').value, 
            r_t: document.getElementById('r_t').value, 
            r_cbu: document.getElementById('r_cbu').value,
            // Destinatario
            d_n, 
            d_d: document.getElementById('d_d').value, 
            d_l: document.getElementById('d_l').value, 
            d_t: document.getElementById('d_t').value, 
            d_cbu: document.getElementById('d_cbu').value,
            // Valores
            flete: tot.flete.toFixed(2), 
            seg: tot.seg.toFixed(2), 
            total: tot.total.toFixed(2), 
            v_decl: tot.v_decl.toFixed(2), 
            cant_t: tot.cant_t,
            // Configuración
            pago_en: document.getElementById('pago_en').value,
            condicion: document.getElementById('condicion').value,
            cr_activo: document.getElementById('cr_activo').value,
            cr_monto: document.getElementById('cr_monto').value || 0,
            estado: "Recibido",
            estado_facturacion: "pendiente",
            // Ítems
            items: Array.from(document.querySelectorAll('#cuerpoItems tr')).map(tr => ({
                c: tr.querySelector('.i-cant').value, 
                t: tr.querySelector('.i-tipo').value, 
                d: tr.querySelector('.i-det').value, 
                u: tr.querySelector('.i-unit').value, 
                vd: tr.querySelector('.i-decl').value
            }))
        };

        try {
            // Guardar guía
            await set(ref(db, `moulin/guias/${Date.now()}`), guia);
            
            // Actualizar clientes (si cambiaron datos)
            const guardarCliente = (n, d, l, t, c) => {
                if(!n) return;
                const idClean = n.replace(/[.#$/[\]]/g, ""); // Firebase no permite estos caracteres en keys
                update(ref(db, `moulin/clientes/${idClean}`), { nombre: n, direccion: d, localidad: l, telefono: t, cbu: c });
            };
            guardarCliente(guia.r_n, guia.r_d, guia.r_l, guia.r_t, guia.r_cbu);
            guardarCliente(guia.d_n, guia.d_d, guia.d_l, guia.d_t, guia.d_cbu);
            
            // Imprimir
            imprimir(guia); 
            
            // Recargar para limpiar
            setTimeout(() => location.reload(), 1500);

        } catch (error) {
            console.error(error);
            alert("❌ Error al conectar con la base de datos.");
        }
    };
}

// 6. IMPRESIÓN (VENTANA EMERGENTE)
window.reimprimirGuia = (num) => {
    const guia = historialGlobal.find(g => g.num === num);
    if (guia) imprimir(guia);
    else alert("No se encontró la guía.");
};

function imprimir(g) {
    // Generar filas HTML
    let itemsH = g.items.map(i => `
        <tr>
            <td align="center" style="border:1px solid #000; padding:4px;">${i.c || i.cant}</td>
            <td style="border:1px solid #000; padding:4px;">${i.t || i.tipo}</td>
            <td style="border:1px solid #000; padding:4px;">${i.d || i.det}</td>
            <td align="right" style="border:1px solid #000; padding:4px;">$${i.u || i.unit}</td>
            <td align="right" style="border:1px solid #000; padding:4px;">$${i.vd || i.v_decl || 0}</td>
        </tr>`).join('');

    let extraCR = (g.cr_activo === "SI") ? `<br><b style="background:black; color:white; padding:2px;">C. REEMBOLSO: $${g.cr_monto}</b>` : "";

    // HTML de la ventana nueva
    let html = `
    <html><head><title>GUIA ${g.num}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: auto; }
        .hoja { border: 2px solid #000; height: 11.5cm; padding: 10px; margin-bottom: 20px; box-sizing: border-box; position: relative; }
        .header { display: flex; align-items: center; border-bottom: 2px solid #000; padding-bottom: 5px; }
        .datos-grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; margin: 10px 0; font-size: 13px; }
        .col { padding: 5px; }
        .col:first-child { border-right: 1px solid #000; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 5px; }
        th { background: #eee; border: 1px solid #000; padding: 4px; }
        .footer-print { margin-top: 10px; display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; border-top: 2px solid #000; padding-top: 5px; }
        .etiqueta { border: 4px dashed #000; padding: 20px; margin-top: 40px; page-break-before: always; display: flex; align-items: center; justify-content: space-between; height: 160px; }
    </style>
    </head><body>`;

    ['ORIGINAL TRANSPORTE', 'DUPLICADO CLIENTE'].forEach(tipo => {
        html += `
        <div class="hoja">
            <div class="header">
                <img src="logo.png" style="height:50px;" onerror="this.style.display='none'"> 
                <div style="margin-left:15px;">
                    <b style="font-size:20px;">TRANSPORTE MOULIN</b><br>
                    <small>Fletes y Encomiendas</small>
                </div>
                <div style="margin-left:auto; text-align:right;">
                    <small>${tipo}</small><br>
                    <b style="font-size:24px; color:black;">${g.num}</b><br>
                    ${g.fecha}
                </div>
            </div>

            <div class="datos-grid">
                <div class="col">
                    <b>REMITENTE:</b><br>
                    ${g.r_n}<br>
                    <small>${g.r_l} - ${g.r_t || ''}</small>
                </div>
                <div class="col">
                    <b>DESTINATARIO:</b><br>
                    ${g.d_n}<br>
                    <small>${g.d_l} - ${g.d_t || ''}</small>
                </div>
            </div>

            <table>
                <thead><tr><th>Cant</th><th>Tipo</th><th>Detalle</th><th>Unit</th><th>V.Decl</th></tr></thead>
                <tbody>${itemsH}</tbody>
            </table>

            <div class="footer-print">
                <div>
                    BULTOS: ${g.cant_t} <br> 
                    CONDICION: ${g.condicion} (${g.pago_en})
                    ${extraCR}
                </div>
                <div style="font-size: 18px;">TOTAL: $${g.total}</div>
            </div>
            
            <div style="position: absolute; bottom: 5px; width: 100%; text-align: center; font-size: 10px;">
                Firma Conforme: _____________________________ Aclaración: ____________________
            </div>
        </div>`;
    });

    // Etiqueta para pegar
    html += `
    <div class="etiqueta">
        <div style="width:30%">
            DESTINO:<br>
            <b style="font-size:26px;">${g.d_l}</b><br>
            ${g.d_n}
        </div>
        <div style="width:40%; text-align:center;">
            <b style="font-size:35px;">${g.num}</b><br>
            BULTOS: ${g.cant_t}
        </div>
        <div style="width:30%; text-align:right;">
            ORIGEN:<br>
            <b>${g.r_l}</b>
        </div>
    </div>
    <script>
        window.onload = function() { window.print(); window.close(); }
    </script>
    </body></html>`;

    const win = window.open('', '_blank');
    if(win) {
        win.document.write(html);
        win.document.close();
    } else {
        alert("⚠️ Habilita las ventanas emergentes (pop-ups) para imprimir.");
    }
}

// 7. RENDERIZADO DE TABLAS Y PESTAÑAS

// Historial Guías
function renderHistorial() {
    const tbody = document.getElementById('listaHistorial');
    if(!tbody) return;
    
    tbody.innerHTML = historialGlobal.slice(0, 30).map(g => {
        let color = "";
        if(g.estado === "Entregado") color = "#eaffea";
        if(g.estado === "Error") color = "#ffeaea";
        
        return `
        <tr style="background-color:${color}">
            <td><b>${g.num}</b></td>
            <td>${g.fecha}</td>
            <td>${g.d_l || '-'}</td>
            <td>
                <select onchange="cambiarEstado('${g.firebaseID}', this.value)" style="font-size:11px;">
                    <option ${g.estado==="Recibido"?"selected":""}>Recibido</option>
                    <option ${g.estado==="En Viaje"?"selected":""}>En Viaje</option>
                    <option ${g.estado==="Deposito"?"selected":""}>Deposito</option>
                    <option ${g.estado==="Entregado"?"selected":""}>Entregado</option>
                </select>
            </td>
            <td><button onclick="reimprimirGuia('${g.num}')">🖨️</button></td>
        </tr>`;
    }).join('');
}

window.cambiarEstado = (id, nuevoEstado) => {
    update(ref(db, `moulin/guias/${id}`), { estado: nuevoEstado });
};

// Tabla de Retiros (¡NUEVO!)
function renderRetiros() {
    const div = document.getElementById('listaRetiros');
    if(!div) return;

    if(retirosGlobal.length === 0) {
        div.innerHTML = "<p style='text-align:center; padding:20px; color:#666;'>No hay solicitudes de retiro.</p>";
        return;
    }

    div.innerHTML = retirosGlobal.map(r => `
        <div class="caja" style="margin-bottom:10px; border-left: 5px solid ${r.estado === 'Realizado' ? 'green' : 'orange'};">
            <div style="display:flex; justify-content:space-between;">
                <b>${r.cliente}</b>
                <small>${new Date(r.timestamp).toLocaleDateString()} ${new Date(r.timestamp).toLocaleTimeString()}</small>
            </div>
            <div>${r.direccion} (${r.localidad})</div>
            <div style="margin: 5px 0; font-style: italic;">"${r.observaciones || 'Sin detalles'}"</div>
            <div style="text-align:right;">
                ${r.estado !== 'Realizado' ? 
                    `<button onclick="completarRetiro('${r.id}')" style="background:#4CAF50; color:white; border:none; padding:5px;">✅ Marcar Realizado</button>` : 
                    `<span style="color:green; font-weight:bold;">COMPLETADO</span>`
                }
            </div>
        </div>
    `).join('');
}

window.completarRetiro = (id) => {
    if(confirm("¿Marcar retiro como realizado?")) {
        update(ref(db, `moulin/retiros/${id}`), { estado: "Realizado" });
    }
};

// Tabla de Clientes con Cuenta Corriente
function renderTablaClientes() {
    const tbody = document.getElementById('cuerpoTablaClientes');
    if(!tbody) return;

    const lista = window.clientesGlobales.filter(c => c.nombre || c.n).slice(0, 50);

    tbody.innerHTML = lista.map(c => {
        const nom = c.nombre || c.n;
        const safeNom = nom.replace(/'/g, "\\'"); // Evitar error de comillas
        
        // Calcular deuda pendiente
        const pendientes = historialGlobal.filter(g => 
            (g.r_n === nom || g.d_n === nom) && 
            g.condicion === "CTA CTE" && 
            g.estado_facturacion !== "facturado"
        );

        let btnEstado = `<span style="color:green;">Al día</span>`;
        if(pendientes.length > 0) {
            btnEstado = `<button onclick="verCuenta('${safeNom}')" style="background:#ff9800; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">
                ⚠️ ${pendientes.length} Pendientes
            </button>`;
        }

        return `
            <tr>
                <td>${nom}</td>
                <td>${c.direccion || c.d || '-'}</td>
                <td>${c.localidad || c.l || '-'}</td>
                <td>${btnEstado}</td>
                <td><button onclick="eliminarCliente('${safeNom}')" style="color:red; background:none; border:none; cursor:pointer;">🗑️</button></td>
            </tr>
        `;
    }).join('');
}

window.eliminarCliente = (nom) => {
    if(confirm(`¿Borrar a ${nom}?`)) {
        set(ref(db, `moulin/clientes/${nom.replace(/[.#$/[\]]/g, "")}`), null);
    }
}

// Función para Exportar Excel (Requiere SheetJS en el HTML)
window.verCuenta = async (cliente) => {
    if(typeof XLSX === 'undefined') return alert("Error: Librería XLSX no cargada.");
    
    const pendientes = historialGlobal.filter(g => 
        (g.r_n === cliente || g.d_n === cliente) && 
        g.condicion === "CTA CTE" && 
        g.estado_facturacion !== "facturado"
    );

    let total = pendientes.reduce((acc, g) => acc + parseFloat(g.total), 0);

    if(!confirm(`Cliente: ${cliente}\nDeuda Total: $${total.toFixed(2)}\n\n¿Descargar Excel y marcar como PAGADO?`)) return;

    // Crear Excel
    const filas = pendientes.map(g => ({
        Fecha: g.fecha,
        Guia: g.num,
        Rol: (g.r_n === cliente) ? 'Remitente' : 'Destinatario',
        Otro: (g.r_n === cliente) ? g.d_n : g.r_n,
        Importe: parseFloat(g.total)
    }));

    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen");
    XLSX.writeFile(wb, `Resumen_${cliente}.xlsx`);

    // Actualizar Firebase
    for(const g of pendientes) {
        if(g.firebaseID) {
            update(ref(db, `moulin/guias/${g.firebaseID}`), { estado_facturacion: "facturado" });
        }
    }
};

// 8. LISTENERS DE TABS (PESTAÑAS)
document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        // 1. Quitar activo a todos
        document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // 2. Activar el clickeado
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
    });
});

// Inicialización
if(document.getElementById('add-item')) document.getElementById('add-item').addEventListener('click', agregarFila);
window.onload = () => { if(document.getElementById('cuerpoItems')) agregarFila(); };
