// AVVIO: nessun dato viene caricato prima del login; se c'è una sessione salvata la si riprende
restoreSession().catch(e=>{console.error(e);document.getElementById('loginScreen').style.display='flex';});
