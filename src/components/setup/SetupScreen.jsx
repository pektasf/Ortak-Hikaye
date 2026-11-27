import React from 'react';
import { BookOpen } from 'lucide-react';

export default function SetupScreen() {
  return (
    <div className="setup">
      <div className="setup-card">
        <BookOpen size={30} />
        <small>KURULUM GEREKİYOR</small>
        <h1>Ortak Roman hazır olmak üzere.</h1>
        <p>Gerçek zamanlı çok yazarlı kullanım için Supabase bağlantısı henüz eklenmemiş.</p>
        <ol>
          <li>Supabase'te ücretsiz bir proje oluştur.</li>
          <li><code>supabase/schema.sql</code> dosyasını SQL Editor'de çalıştır.</li>
          <li><code>.env.example</code> dosyasını <code>.env</code> olarak kopyala ve URL ile anon key'i ekle.</li>
          <li><code>npm install</code> ve <code>npm run dev</code> komutlarını çalıştır.</li>
        </ol>
        <p>Servis rolü anahtarını tarayıcıya koyma. İlk sahip hesabı SQL yönergesiyle yetkilendir.</p>
      </div>
    </div>
  );
}