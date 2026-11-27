import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './features/book/App.jsx';
import './styles/tokens.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('Ortak Roman açılış hatası:', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:'24px',background:'#f5f0e8',color:'#332822',fontFamily:"'DM Sans',Arial,sans-serif"}}>
          <section style={{width:'min(100%,520px)',padding:'32px',border:'1px solid #e7ded2',borderRadius:'16px',background:'#fffdf8',boxShadow:'0 18px 55px rgba(55,39,27,.09)'}}>
            <div style={{fontSize:'11px',letterSpacing:'.16em',color:'#a47a59'}}>ORTAK ROMAN</div>
            <h1 style={{fontFamily:"'EB Garamond',Georgia,serif",fontSize:'34px',fontWeight:500}}>Sayfa açılırken bir sorun oluştu.</h1>
            <p style={{lineHeight:1.7,color:'#87796d'}}>Uygulama beklenmeyen bir hata ile karşılaştı. Sayfayı yenileyerek yeniden deneyebilirsin.</p>
            <button onClick={()=>window.location.reload()} style={{border:0,borderRadius:'999px',padding:'12px 18px',background:'#563a3b',color:'#fff',cursor:'pointer'}}>Sayfayı yenile</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
