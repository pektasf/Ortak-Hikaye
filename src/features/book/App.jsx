import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client.js';
import { words } from '../../lib/text.js';
import SetupScreen from '../../components/setup/SetupScreen.jsx';
import '../../styles/global.css';
import '../../styles/reader-pagination.css';

function renderHighlightedText(content, blockId, highlights) {
  const text = String(content || '');
  const matches = (highlights || [])
    .filter(item => item.block_id === blockId
      && item.start_offset >= 0
      && item.end_offset <= text.length
      && item.end_offset > item.start_offset
      && text.slice(item.start_offset, item.end_offset) === item.sentence_text)
    .sort((a, b) => a.start_offset - b.start_offset || a.end_offset - b.end_offset);
  if (!matches.length) return text;
  const nodes = [];
  let cursor = 0;
  for (const item of matches) {
    if (item.start_offset < cursor) continue;
    if (item.start_offset > cursor) nodes.push(text.slice(cursor, item.start_offset));
    nodes.push(<span className="sentence-highlight" key={item.id} title="Cümle vurgusu">{text.slice(item.start_offset, item.end_offset)}</span>);
    cursor = item.end_offset;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderReaderHighlightedText(content, highlights) {
  const text = String(content || '');
  const matches = (highlights || [])
    .map(item => item.sentence_text)
    .filter(Boolean)
    .map(sentence => ({ sentence, start: text.indexOf(sentence) }))
    .filter(item => item.start >= 0)
    .sort((a, b) => a.start - b.start);
  if (!matches.length) return text;
  const nodes = [];
  let cursor = 0;
  matches.forEach((item, index) => {
    if (item.start < cursor) return;
    if (item.start > cursor) nodes.push(text.slice(cursor, item.start));
    nodes.push(<span className="sentence-highlight" key={item.start + '-' + index} title="Altı çizili cümle">{item.sentence}</span>);
    cursor = item.start + item.sentence.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function readWriterCanvasBlocks(root, userId) {
  if (!root) return [];
  const nodes = Array.from(root.childNodes || []);
  const blocks = [];
  for (const node of nodes) {
    const content = node.nodeType === 3
      ? node.textContent
      : (node.innerText || node.textContent || '');
    const normalized = String(content || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').trimEnd();
    if (!normalized.trim()) continue;
    const id = node.nodeType === 1 ? node.getAttribute('data-block-id') : null;
    blocks.push({ id: id || null, content: normalized, author_id: userId });
  }
  if (!blocks.length) {
    const fallback = String(root.innerText || root.textContent || '')
      .replace(/\r/g, '').replace(/\u00a0/g, ' ').trim();
    if (fallback) {
      fallback.split(/\n\s*\n/).filter(Boolean)
        .forEach(content => blocks.push({ id: null, content: content.trimEnd(), author_id: userId }));
    }
  }
  return blocks;
}

function measureBookPages(value, element) {
 const paragraphs=String(value||'').split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
 if(!paragraphs.length||!element||!element.clientWidth||!element.clientHeight)return [];
 const probe=element.cloneNode(false),rect=element.getBoundingClientRect();
 Object.assign(probe.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',display:'block',width:rect.width+'px',height:element.clientHeight+'px',overflow:'hidden',contain:'layout style paint',pointerEvents:'none'});
 document.body.appendChild(probe);
 const fits=text=>{const p=document.createElement('p');p.textContent=text;probe.appendChild(p);const ok=probe.scrollHeight<=probe.clientHeight+1;p.remove();return ok;};
 const pages=[];let page=[];
 const flush=()=>{if(page.length)pages.push(page.join('\n\n'));page=[];};
 const append=text=>{const p=document.createElement('p');p.textContent=text;probe.appendChild(p);page.push(text);};
 for(const paragraph of paragraphs){
  if(fits(paragraph)){append(paragraph);continue;}
  let rest=paragraph.split(/\s+/);
  while(rest.length){
   let low=1,high=rest.length,best=0;
   while(low<=high){const mid=Math.floor((low+high)/2);if(fits(rest.slice(0,mid).join(' '))){best=mid;low=mid+1;}else high=mid-1;}
   if(!best){if(page.length){flush();probe.innerHTML='';continue;}best=1;}
   const part=rest.slice(0,best).join(' ');
   if(page.length&&!fits(part)){flush();probe.innerHTML='';continue;}
   append(part);rest=rest.slice(best);if(rest.length){flush();probe.innerHTML='';}
  }
 }
 flush();probe.remove();return pages;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState('writer');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState(null);
  const [settings, setSettings] = useState({ title: '', subtitle: '', note: '', target_words: 1000, extension_words: 1000 });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [stories, setStories] = useState([]);
  const [activeStoryId, setActiveStoryId] = useState('');
  const [storyTitleDraft, setStoryTitleDraft] = useState('');
  const [storyTitleBusy, setStoryTitleBusy] = useState(false);
  const [readerAuthors, setReaderAuthors] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [activeChapterId, setActiveChapterId] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorBlocks, setEditorBlocks] = useState([]);
  const [sentenceHighlights, setSentenceHighlights] = useState([]);
  const [selectedSentence, setSelectedSentence] = useState(null);
  const [editorStatus, setEditorStatus] = useState('draft');
  const [editorDirty, setEditorDirty] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyInviteLinks, setStoryInviteLinks] = useState({});
  const [revisions, setRevisions] = useState([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [writingWidth, setWritingWidth] = useState('notebook');
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ display_name: '', bio: '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [discoverAuthors, setDiscoverAuthors] = useState([]);
  const [authorQuery, setAuthorQuery] = useState('');
  const [publicProfileId, setPublicProfileId] = useState(null);
  const [readingIndex, setReadingIndex] = useState(0);
  const [writingLock, setWritingLock] = useState(null);
  const [activeWritingLocks, setActiveWritingLocks] = useState({});
  const [writingPresenceReady, setWritingPresenceReady] = useState(false);
  const [loadingChapterContent, setLoadingChapterContent] = useState(false);
  const [lockNotice, setLockNotice] = useState('');
  const [view, setView] = useState('home');
  const [writingFont, setWritingFont] = useState('serif');
  const [writingSize, setWritingSize] = useState('20');
  const [writingLineHeight, setWritingLineHeight] = useState('1.9');
  const [readerLayout, setReaderLayout] = useState('spread');
  const [readerPageIndex, setReaderPageIndex] = useState(0);
  const [readerPages, setReaderPages] = useState([]);
  const readerPageMeasureRef = useRef(null);
  const readerRestorePendingRef = useRef(false);
  const readerPageRestoreRef = useRef(null);
  const readerProgressTimerRef = useRef(null);
  const [readerScrollRestore, setReaderScrollRestore] = useState(0);
  const [draftSaveState, setDraftSaveState] = useState('idle');
  const draftSaveTimerRef = useRef(null);
  const draftRestorePromptRef = useRef(new Set());
  const [readerTurn, setReaderTurn] = useState(null);
  const [isCompactReader, setIsCompactReader] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 760px)').matches
      : false
  );
  const readerTurnTimerRef = useRef(null);

  const userId = session?.user?.id;
  const activeStory = stories.find(item => item.id === activeStoryId) || null;
  const activeChapter = chapters.find(item => item.id === activeChapterId) || null;
  const isStoryOwner = Boolean(activeStory && activeStory.owner_id === userId);
  // Saved chapters are readable by story members before publication; publication is a separate status.
  // The reader always shows the latest saved snapshot, even while another author holds the writing lock.
  // Unsaved edits stay private because only chapters.content (the last saved version) is rendered here.
  const readerChapters = chapters.filter(item => writingPresenceReady && String(item.content || '').trim().length > 0);
  const readerChapter = readerChapters[readingIndex] || readerChapters[0] || null;
  const effectiveReaderLayout = isCompactReader && readerLayout === 'spread' ? 'single' : readerLayout;
  const readerPageStep = effectiveReaderLayout === 'spread' ? 2 : 1;
  useEffect(()=>{if(view!=='reader'||effectiveReaderLayout==='scroll')return;setReaderPages([]);let frame=0;const measure=()=>{window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(()=>setReaderPages(measureBookPages(readerChapter?.content||'',readerPageMeasureRef.current)));};measure();const el=readerPageMeasureRef.current;const observer=typeof ResizeObserver!=='undefined'&&el?new ResizeObserver(measure):null;if(observer&&el)observer.observe(el);window.addEventListener('resize',measure,{passive:true});document.fonts?.ready?.then(measure);return()=>{window.cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',measure);};},[view,readerChapter?.id,readerChapter?.content,effectiveReaderLayout]);
  const readerMaxPageIndex = effectiveReaderLayout === 'spread'
    ? Math.max(0, Math.ceil(readerPages.length / 2) * 2 - 2)
    : Math.max(0, readerPages.length - 1);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      const syncLayout = () => setIsCompactReader(window.innerWidth <= 760);
      syncLayout();
      window.addEventListener('resize', syncLayout, { passive: true });
      return () => window.removeEventListener('resize', syncLayout);
    }
    const media = window.matchMedia('(max-width: 760px)');
    const syncLayout = event => setIsCompactReader(event.matches);
    setIsCompactReader(media.matches);
    if (media.addEventListener) media.addEventListener('change', syncLayout);
    else media.addListener(syncLayout);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', syncLayout);
      else media.removeListener(syncLayout);
    };
  }, []);

  useEffect(() => () => {
    if (readerTurnTimerRef.current !== null) window.clearTimeout(readerTurnTimerRef.current);
  }, []);

  useEffect(() => {
    if (readerTurnTimerRef.current !== null) {
      window.clearTimeout(readerTurnTimerRef.current);
      readerTurnTimerRef.current = null;
    }
    setReaderTurn(null);
    if(readerRestorePendingRef.current) readerRestorePendingRef.current=false;
    else setReaderPageIndex(0);
  }, [readerChapter?.id]);

  useEffect(() => {
    if (readerTurnTimerRef.current !== null) {
      window.clearTimeout(readerTurnTimerRef.current);
      readerTurnTimerRef.current = null;
    }
    setReaderTurn(null);
    setReaderPageIndex(current => Math.min(current, readerMaxPageIndex));
  }, [effectiveReaderLayout, readerMaxPageIndex]);

  useEffect(() => {
    if (view !== 'reader' || effectiveReaderLayout === 'scroll') return;
    const handleReaderKeys = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const focused = document.activeElement;
      const typing = focused instanceof HTMLElement && (
        focused.isContentEditable || focused.matches('input, textarea, select, [role="textbox"]')
      );
      if (typing) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        turnBookPage(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        turnBookPage(-1);
      }
    };
    window.addEventListener('keydown', handleReaderKeys);
    return () => window.removeEventListener('keydown', handleReaderKeys);
  }, [view, effectiveReaderLayout, readerChapter?.id, readerPageIndex, readerTurn, readerPages.length]);

  async function loadChapterBlocks(chapterId) {
    const { data, error } = await supabase.from('chapter_blocks')
      .select('id,content,author_id,updated_by,position').eq('chapter_id', chapterId).order('position');
    if (error) { setNotice('Paragraflar yüklenemedi: ' + error.message); return []; }
    const { data: authors } = await supabase.rpc('get_story_author_names', { p_chapter_id: chapterId });
    const names = Object.fromEntries((authors || []).map(item => [item.user_id, item.display_name]));
    let blocks = (data || []).map(block => ({...block,author_name:names[block.author_id] || (block.author_id ? 'Yazar' : 'Eski metin'),editor_name:names[block.updated_by] || 'Yazar'}));
    // Older chapters may have content stored on chapters.content without chapter_blocks rows.
    if (!blocks.length) {
      const legacyContent = chapters.find(item => item.id === chapterId)?.content || '';
      if (String(legacyContent).trim()) {
        blocks = legacyContent.split(/\n\s*\n/).filter(Boolean).map(content => ({id:null,content,author_id:null,updated_by:null}));
      }
    }
    setEditorBlocks(blocks);
    setEditorContent(blocks.map(block => block.content).join('\n\n') || '');
    const localKey='ortak_roman_draft:'+userId+':'+chapterId;let localDraft=null;try{localDraft=JSON.parse(window.localStorage.getItem(localKey)||'null');}catch{localDraft=null;}
    const {data:remoteDraft,error:draftError}=await supabase.from('chapter_drafts').select('title,status,blocks,updated_at').eq('chapter_id',chapterId).eq('user_id',userId).maybeSingle();
    if(draftError)setNotice('Taslak kontrol edilemedi: '+draftError.message);
    const newest=[remoteDraft,localDraft].filter(item=>item?.updated_at&&Array.isArray(item.blocks)).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at))[0];
    if(newest&&new Date(newest.updated_at).getTime()>new Date(chapters.find(item=>item.id===chapterId)?.updated_at||0).getTime()){setEditorTitle(newest.title||activeChapter?.title||'');setEditorStatus(newest.status||'draft');const restored=newest.blocks.map(item=>({...item,author_id:item.author_id||userId}));setEditorBlocks(restored);setEditorContent(restored.map(item=>item.content).join('\n\n'));setEditorDirty(true);}
    const { data: highlights, error: highlightError } = await supabase
      .from('chapter_sentence_highlights')
      .select('id,chapter_id,block_id,author_id,sentence_text,start_offset,end_offset,created_at')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (highlightError) setNotice('Cümle vurguları yüklenemedi: ' + highlightError.message);
    else setSentenceHighlights(highlights || []);
    setSelectedSentence(null);
    return blocks;
  }

  useEffect(() => {
    if (view !== 'reader' || !readerChapter?.id) return;
    let alive = true;
    supabase.from('chapter_sentence_highlights')
      .select('id,chapter_id,block_id,author_id,sentence_text,start_offset,end_offset,created_at')
      .eq('chapter_id', readerChapter.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setNotice('Cümle altı çizgileri yüklenemedi: ' + error.message);
        else setSentenceHighlights(data || []);
      });
    return () => { alive = false; };
  }, [view, readerChapter?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storyInvite = params.get('story_invite');
    const setup = params.get('setup');
    if (storyInvite) window.localStorage.setItem('ortak_roman_story_invite', storyInvite);
    if (setup === '1') window.localStorage.setItem('ortak_roman_bootstrap', '1');
    if (storyInvite || setup) window.history.replaceState({}, '', window.location.pathname);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setAuthorized(false);
      setStories([]);
      setChapters([]);
      setActiveStoryId('');
      return;
    }
    let active = true;
    async function checkAccess() {
      const token = window.localStorage.getItem('ortak_roman_story_invite');
      if (token) {
        const { error } = await supabase.rpc('redeem_story_invite', { p_token: token });
        window.localStorage.removeItem('ortak_roman_story_invite');
        if (error && active) setNotice('Hikâye daveti doğrulanamadı: ' + error.message);
      }
      window.localStorage.removeItem('ortak_roman_bootstrap');
      const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }] = await Promise.all([
        supabase.from('profiles').select('role,display_name').eq('id', session.user.id).maybeSingle(),
        supabase.from('story_members').select('story_id,role').eq('user_id', session.user.id)
      ]);
      if (!active) return;
      if (profileError) setNotice('Profil kontrolü yapılamadı: ' + profileError.message);
      if (membershipError) setNotice('Hikâye üyeliği kontrol edilemedi: ' + membershipError.message);
      const nextRole = profile?.role || 'writer';
      const allowed = ['owner', 'moderator'].includes(nextRole) || Boolean(memberships?.length);
      setRole(nextRole);
      setAuthorized(allowed);
      if (profile?.display_name && profile.display_name !== 'Yazar') setName(profile.display_name);
      if (!allowed) setNotice('Bu hesap henüz bir hikâyeye üye değil. Geçerli hikâye davet bağlantısını açıp yeniden giriş yap.');
    }
    checkAccess();
    return () => { active = false; };
  }, [session]);

  async function refreshWorkspace() {
    if (!supabase || !session || !authorized) return;
    const [bookResult, storyResult] = await Promise.all([
      supabase.from('books').select('*').limit(1).maybeSingle(),
      supabase.from('stories').select('id,title,description,status,owner_id,target_words,created_at,updated_at').order('updated_at', { ascending: false })
    ]);
    if (bookResult.error) setNotice('Kitap bilgisi yüklenemedi: ' + bookResult.error.message);
    else if (bookResult.data) setBook(bookResult.data);
    if (storyResult.error) setNotice('Hikâyeler yüklenemedi: ' + storyResult.error.message);
    else {
      setStories(storyResult.data || []);
      setActiveStoryId(current => (storyResult.data || []).some(item => item.id === current) ? current : (storyResult.data?.[0]?.id || ''));
    }
  }

  async function refreshChapters(storyId = activeStoryId) {
    if (!supabase || !storyId) { setChapters([]); return; }
    const { data, error } = await supabase.from('chapters')
      .select('id,story_id,title,content,status,target_words,sort_order,created_by,created_at,updated_at')
      .eq('story_id', storyId).order('sort_order').order('created_at');
    if (error) setNotice('Bölümler yüklenemedi: ' + error.message);
    else {
      setChapters(data || []);
      const { data: progress } = await supabase.from('reading_progress')
        .select('chapter_id,page_index,reader_layout,scroll_position').eq('user_id', userId).eq('story_id', storyId).maybeSingle();
      const restoredChapterId=(data||[]).some(item=>item.id===progress?.chapter_id)?progress.chapter_id:(data?.[0]?.id||'');
      setActiveChapterId(current=>(data||[]).some(item=>item.id===current)?current:restoredChapterId);
      const restoredReaderIndex=(data||[]).filter(item=>String(item.content||'').trim().length>0).findIndex(item=>item.id===progress?.chapter_id);if(restoredReaderIndex>=0)setReadingIndex(restoredReaderIndex);
      if(progress?.reader_layout&&['single','spread','scroll'].includes(progress.reader_layout))setReaderLayout(progress.reader_layout);
      if(progress?.chapter_id===restoredChapterId){readerRestorePendingRef.current=true;readerPageRestoreRef.current=Math.max(0,progress.page_index||0);setReaderPageIndex(0);setReaderScrollRestore(Math.max(0,progress.scroll_position||0));}
    }
  }

  useEffect(() => {    if (!authorized || !session) return;
    refreshWorkspace();
    const channel = supabase.channel('ortak-roman-workspace-' + session.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, refreshWorkspace)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chapters' }, () => refreshChapters())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_members' }, refreshWorkspace)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, authorized]);

  useEffect(() => {
    if (!authorized || !activeStoryId) {
      setChapters([]);
      setActiveChapterId('');
      return;
    }
    setChapters([]);
    setActiveChapterId('');
    refreshChapters(activeStoryId);
  }, [activeStoryId, authorized]);

  useEffect(() => {
    if (!authorized || !activeStoryId) { setActiveWritingLocks({}); setWritingPresenceReady(false); return; }
    setWritingPresenceReady(false);
    let alive = true;
    const refreshPresence = async () => {
      const ids = chapters.map(item => item.id);
      if (!ids.length) { if (alive) { setActiveWritingLocks({}); setWritingPresenceReady(true); } return; }
      const { data, error } = await supabase.from('chapter_writing_locks').select('chapter_id,user_id,expires_at').in('chapter_id', ids).gt('expires_at', new Date().toISOString());
      if (error) { if (alive) setNotice('Yazma durumu alınamadı: ' + error.message); return; }
      const rows = data || [];
      const { data: authors } = await supabase.rpc('get_story_author_names', { p_chapter_id: ids[0] });
      const names = Object.fromEntries((authors || []).map(item => [item.user_id, item.display_name || 'Bir yazar']));
      const next = Object.fromEntries(rows.map(item => [item.chapter_id, {user_id:item.user_id,display_name:names[item.user_id] || 'Bir yazar',expires_at:item.expires_at}]));
      if (alive) { setActiveWritingLocks(next); setWritingPresenceReady(true); }
    };
    refreshPresence();
    const channel = supabase.channel('story-writing-presence-' + activeStoryId).on('postgres_changes', {event:'*',schema:'public',table:'chapter_writing_locks'}, refreshPresence).subscribe();
    const timer = window.setInterval(refreshPresence, 15000);
    return () => { alive=false; window.clearInterval(timer); supabase.removeChannel(channel); };
  }, [authorized, activeStoryId, chapters.map(item => item.id).join('|')]);

  useEffect(() => {
    if (!authorized || !focusMode || !writingLock?.acquired || !loadingChapterContent || !activeChapterId) return;
    let alive = true;
    (async () => {
      const chapter = chapters.find(item => item.id === activeChapterId);
      if (!chapter) { setLoadingChapterContent(false); return; }
      setEditorTitle(chapter.title || ''); setEditorStatus(chapter.status || 'draft');
      await loadChapterBlocks(chapter.id);
      if (!alive) return;
      // Keep a restored personal draft marked as dirty so it remains protected
      // and can be resumed without silently replacing it with the shared version.
      setLoadingChapterContent(false);
    })();
    return () => { alive=false; };
  }, [authorized, focusMode, writingLock?.acquired, loadingChapterContent, activeChapterId]);

  useEffect(()=>{if(!authorized||!userId||!activeStoryId||!readerChapter||view!=='reader')return;if(readerProgressTimerRef.current)window.clearTimeout(readerProgressTimerRef.current);readerProgressTimerRef.current=window.setTimeout(async()=>{const sheet=document.querySelector('.reader-scroll-sheet');const scrollPosition=effectiveReaderLayout==='scroll'?Math.max(0,Math.round(sheet?.scrollTop||0)):0;const {error}=await supabase.from('reading_progress').upsert({user_id:userId,story_id:activeStoryId,chapter_id:readerChapter.id,page_index:readerPageIndex,reader_layout:readerLayout,scroll_position:scrollPosition},{onConflict:'user_id,story_id'});if(error)setNotice('Okuma konumu kaydedilemedi: '+error.message);},350);return()=>{if(readerProgressTimerRef.current)window.clearTimeout(readerProgressTimerRef.current);};},[readerPageIndex,readerLayout,readingIndex,readerChapter?.id,activeStoryId,authorized,userId,view,effectiveReaderLayout]);

  useEffect(() => {
    if (!authorized || !focusMode || !activeChapterId || !userId) { setWritingLock(null); return; }
    let alive = true;
    let timer;
    let ownsLock = false;
    const acquire = async () => {
      const { data, error } = await supabase.rpc('acquire_chapter_writing_lock', { p_chapter_id: activeChapterId });
      if (!alive) return;
      if (error) { setLoadingChapterContent(false); setWritingLock({ acquired:false, display_name:'Başka bir yazar', error:error.message }); return; }
      ownsLock = Boolean(data?.acquired && data.user_id === userId);
      setWritingLock(data);
      if (!data?.acquired) setLoadingChapterContent(false);
      setLockNotice(data?.acquired ? '' : (data?.display_name || 'Bir yazar') + ' şu anda bu bölümü yazıyor.');
    };
    acquire();
    timer = window.setInterval(async () => {
      if (!alive) return;
      if (ownsLock) {
        const { data, error } = await supabase.rpc('renew_chapter_writing_lock', { p_chapter_id: activeChapterId });
        if (error || data !== true) { ownsLock=false; setWritingLock({ acquired:false, display_name:'Yazma oturumu sona erdi' }); }
      } else acquire();
    }, 12000);
    const channel = supabase.channel('chapter-lock-' + activeChapterId)
      .on('postgres_changes', { event:'*', schema:'public', table:'chapter_writing_locks', filter:'chapter_id=eq.' + activeChapterId }, () => {
        // Re-check only while waiting for another writer. Our own release event
        // must never trigger a fresh acquire and immediately hide the saved chapter.
        if (alive && !ownsLock) acquire();
      })
      .subscribe();
    return () => {
      alive=false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
      if (ownsLock) supabase.rpc('release_chapter_writing_lock', { p_chapter_id: activeChapterId });
    };
  }, [authorized, activeChapterId, userId, focusMode]);

  useEffect(() => {
    if (view === 'discover') loadDiscover('');
  }, [view]);

  useEffect(() => {
    if (!focusMode) return;
    document.documentElement.classList.add('writing-studio-active');
    return () => document.documentElement.classList.remove('writing-studio-active');
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = event => {
      if (event.key === 'Escape') exitWritingStudio();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        document.querySelector('.chapter-editor')?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode, editorDirty]);

  useEffect(() => {
    // The focus-mode loader is the single source of truth while a writing session is active.
    // Avoid racing it with the preview loader and accidentally replacing restored draft text.
    if (!activeChapter || editorDirty || focusMode) return;
    let cancelled = false;
    setEditorTitle(activeChapter.title);
    setEditorStatus(activeChapter.status || 'draft');
    loadChapterBlocks(activeChapter.id).then(loaded => {
      if (cancelled) return;
      if (!loaded.length && activeChapter.content) {
        const legacyBlocks = activeChapter.content.split(/\n\s*\n/).filter(Boolean).map(content => ({id:null,content,author_id:null,updated_by:null}));
        setEditorBlocks(legacyBlocks);
        setEditorContent(activeChapter.content);
      }
    });
    return () => { cancelled = true; };
  }, [activeChapterId, activeChapter?.updated_at, editorDirty, focusMode]);

  useEffect(()=>{if(!activeChapter||!userId||!editorDirty)return;if(draftSaveTimerRef.current)window.clearTimeout(draftSaveTimerRef.current);setDraftSaveState('pending');draftSaveTimerRef.current=window.setTimeout(async()=>{const localKey='ortak_roman_draft:'+userId+':'+activeChapter.id;const canvas=document.querySelector('.writer-rich-canvas');const currentBlocks=canvas?readWriterCanvasBlocks(canvas,userId):editorBlocks;const blocks=currentBlocks.map(block=>({id:block.id||null,content:block.content,author_id:block.author_id||userId}));const updatedAt=new Date().toISOString();const draft={title:editorTitle,status:editorStatus,blocks,updated_at:updatedAt};try{window.localStorage.setItem(localKey,JSON.stringify(draft));}catch{setDraftSaveState('device-error');}const {error}=await supabase.from('chapter_drafts').upsert({chapter_id:activeChapter.id,user_id:userId,title:editorTitle.trim()||activeChapter.title,status:editorStatus,blocks,updated_at:updatedAt},{onConflict:'chapter_id,user_id'});setDraftSaveState(error?'device-only':'saved');if(error)setNotice('Taslak cihazda korundu; sunucuya eşitlenemedi: '+error.message);},1000);return()=>{if(draftSaveTimerRef.current)window.clearTimeout(draftSaveTimerRef.current);};},[activeChapter?.id,userId,editorDirty,editorTitle,editorStatus,editorBlocks,editorContent]);

  useEffect(() => {
    if (activeStory) setStoryTitleDraft(activeStory.title || '');
  }, [activeStory?.id, activeStory?.title]);

  useEffect(() => {
    if (!book || settingsDirty) return;
    setSettings({
      title: book.title || '', subtitle: book.subtitle || '', note: book.note || '',
      target_words: book.target_words || 1000, extension_words: book.extension_words || 1000
    });
  }, [book?.id, book?.title, book?.subtitle, book?.note, book?.target_words, book?.extension_words, settingsDirty]);

  useEffect(() => {
    if (view !== 'reader' || !activeStoryId) return;
    const chapter = chapters.find(item => item.story_id === activeStoryId);
    if (!chapter) { setReaderAuthors([]); return; }
    let alive = true;
    supabase.rpc('get_story_author_names', { p_chapter_id: chapter.id }).then(({data,error}) => {
      if (!alive) return;
      if (error) { setReaderAuthors([]); setNotice('Yazar bilgileri yüklenemedi: ' + error.message); }
      else setReaderAuthors((data || []).map(item => item.display_name).filter(Boolean));
    });
    return () => { alive = false; };
  }, [view, activeStoryId, chapters.map(item => item.id).join('|')]);

  useEffect(()=>{if(readerPageRestoreRef.current===null||!readerPages.length)return;setReaderPageIndex(Math.min(readerPageRestoreRef.current,readerMaxPageIndex));readerPageRestoreRef.current=null;},[readerPages.length,readerMaxPageIndex]);
  useEffect(()=>{if(view!=='reader'||effectiveReaderLayout!=='scroll'||!readerScrollRestore)return;const sheet=document.querySelector('.reader-scroll-sheet');if(sheet){sheet.scrollTop=readerScrollRestore;setReaderScrollRestore(0);}},[view,effectiveReaderLayout,readerChapter?.id,readerScrollRestore]);

  if (!supabase) return <SetupScreen />;

  async function signIn(event) {
    event.preventDefault();
    const storyInvite = window.localStorage.getItem('ortak_roman_story_invite');
    const bootstrap = window.localStorage.getItem('ortak_roman_bootstrap') === '1';
    if (!storyInvite && !bootstrap) {
      setNotice('Giriş için önce hikâye davet bağlantısını açmalısın. Ana yönetici hesabı için site adresinin sonuna ?setup=1 ekle.');
      return;
    }
    setBusy(true);
    if (storyInvite) {
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: { name: name.trim() || 'Yazar' } }
      });
      if (error) setNotice('Davetle katılım başlatılamadı: ' + error.message);
      else setNotice('Davet doğrulanıyor, hikâyen hazırlanıyor…');
    } else {
      const redirect = window.location.origin + window.location.pathname + '?setup=1';
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: redirect, shouldCreateUser: true }
      });
      setNotice(error?.message || 'Yönetici giriş bağlantısı e-posta adresine gönderildi.');
    }
    setBusy(false);
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Davet bağlantısı kopyalandı.');
    } catch {
      setNotice('Bağlantıyı seçip kopyalayabilirsin.');
    }
  }

  async function createStory(event) {
    event.preventDefault();
    if (!newStoryTitle.trim() || !book?.id) return;
    setStoryBusy(true);
    const { data, error } = await supabase.rpc('create_story', {
      p_book_id: book.id, p_title: newStoryTitle.trim(),
      p_description: newStoryDescription.trim()
    });
    if (error) setNotice('Hikâye oluşturulamadı: ' + error.message);
    else {
      setStories(items => [data, ...items]);
      setActiveStoryId(data.id);
      setNewStoryTitle('');
      setNewStoryDescription('');
      setNotice('Hikâyen oluşturuldu. İlk bölümünü şimdi ekleyebilirsin.');
    }
    setStoryBusy(false);
  }

  function captureSentenceSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setSelectedSentence(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const canvas = document.querySelector('.writer-rich-canvas');
    if (!canvas || !canvas.contains(range.commonAncestorContainer)) {
      setSelectedSentence(null);
      return;
    }
    const elementFor = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const startParagraph = elementFor(range.startContainer)?.closest('p[data-block-id]');
    const endParagraph = elementFor(range.endContainer)?.closest('p[data-block-id]');
    if (!startParagraph || startParagraph !== endParagraph) {
      setSelectedSentence(null);
      return;
    }
    const blockId = startParagraph.getAttribute('data-block-id');
    if (!blockId) {
      setSelectedSentence(null);
      setNotice('Önce bölümü kaydet; ardından bu paragraftaki cümleyi vurgulayabilirsin.');
      return;
    }
    const rawText = range.toString();
    const sentence = rawText.trim();
    if (!sentence || sentence.length > 2000) {
      setSelectedSentence(null);
      return;
    }
    const leading = rawText.length - rawText.trimStart().length;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(startParagraph);
    prefix.setEnd(range.startContainer, range.startOffset);
    const startOffset = prefix.toString().length + leading;
    setSelectedSentence({
      chapter_id: activeChapterId,
      block_id: blockId,
      sentence_text: sentence,
      start_offset: startOffset,
      end_offset: startOffset + sentence.length
    });
  }

  async function addSentenceHighlight() {
    if (!selectedSentence || !writingLock?.acquired || selectedSentence.chapter_id !== activeChapterId) return;
    const payload = { ...selectedSentence, author_id: userId };
    const { data, error } = await supabase
      .from('chapter_sentence_highlights')
      .insert(payload)
      .select('id,chapter_id,block_id,author_id,sentence_text,start_offset,end_offset,created_at')
      .single();
    if (error) {
      setNotice(error.code === '23505' ? 'Bu cümleyi zaten vurgulamışsın.' : 'Cümle vurgulanamadı: ' + error.message);
      return;
    }
    setSentenceHighlights(items => [...items, data]);
    setSelectedSentence(null);
    window.getSelection()?.removeAllRanges();
    setNotice('Cümlenin altı çizildi ve yazar profiline eklendi.');
  }

  async function openProfile(targetId) {
    // onClick passes a React event when a handler is supplied directly.
    // Never forward that DOM event to Supabase; accept only a user ID.
    const profileUserId = typeof targetId === 'string' && targetId.trim()
      ? targetId.trim()
      : userId;
    if (!profileUserId) {
      setNotice('Profil bilgisi alınamadı. Lütfen yeniden giriş yap.');
      return;
    }
    if (editorDirty && !window.confirm('Kaydedilmemiş bölüm değişikliklerin var. Profil sayfasına geçmek istiyor musun?')) return;
    setProfileBusy(true);
    const { data, error } = await supabase.rpc('get_author_profile', { p_user_id: profileUserId });
    if (error) setNotice('Profil yüklenemedi: ' + error.message);
    else {
      setProfile(data);
      setPublicProfileId(profileUserId);
      setProfileForm({ display_name: data.display_name || '', bio: data.bio || '' });
      setView('profile');
    }
    setProfileBusy(false);
  }

  async function loadDiscover(query = authorQuery) {
    const { data, error } = await supabase.rpc('search_author_profiles', { p_query: query, p_limit: 36 });
    if (error) setNotice('Yazarlar yüklenemedi: ' + error.message);
    else setDiscoverAuthors(data || []);
  }

  async function toggleFollow(targetId, currentlyFollowing) {
    if (!targetId || targetId === userId) return;
    const result = currentlyFollowing
      ? await supabase.from('author_follows').delete().eq('follower_id', userId).eq('followed_id', targetId)
      : await supabase.from('author_follows').insert({ follower_id: userId, followed_id: targetId });
    if (result.error) setNotice('Takip işlemi yapılamadı: ' + result.error.message);
    else {
      if (publicProfileId === targetId) await openProfile(targetId);
      await loadDiscover();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileBusy(true);
    const { data, error } = await supabase.rpc('update_author_profile', {
      p_display_name: profileForm.display_name.trim(), p_bio: profileForm.bio
    });
    if (error) setNotice('Profil kaydedilemedi: ' + error.message);
    else {
      setProfile(current => ({ ...current, ...data }));
      setName(data.display_name);
      setNotice('Profilin güncellendi.');
    }
    setProfileBusy(false);
  }

  async function deleteStory() {
    if (!activeStory || !isStoryOwner) return;
    if (editorDirty && !window.confirm('Kaydedilmemiş bölüm değişikliklerin var. Yine de hikâyeyi silmek istiyor musun?')) return;
    if (!window.confirm('“' + activeStory.title + '” kalıcı olarak silinecek. Bölümler, sürümler, davetler ve okuma ilerlemeleri de silinir. Bu işlem geri alınamaz. Devam edilsin mi?')) return;
    setStoryBusy(true);
    const { error } = await supabase.rpc('delete_story', { p_story_id: activeStory.id });
    if (error) setNotice('Hikâye silinemedi: ' + error.message);
    else {
      const remaining = stories.filter(item => item.id !== activeStory.id);
      setStories(remaining);
      setActiveStoryId(remaining[0]?.id || '');
      setChapters([]); setActiveChapterId('');
      setEditorTitle(''); setEditorContent(''); setEditorDirty(false); setFocusMode(false);
      setNotice('Hikâye ve ona bağlı kayıtlar silindi.');
    }
    setStoryBusy(false);
  }

  async function makeStoryInvite(storyId) {
    setStoryBusy(true);
    const { data, error } = await supabase.rpc('create_story_invite', {
      p_story_id: storyId, p_max_uses: null, p_hours_valid: 168
    });
    if (error) setNotice('Hikâye daveti oluşturulamadı: ' + error.message);
    else {
      const url = window.location.origin + window.location.pathname + '?story_invite=' + encodeURIComponent(data);      setStoryInviteLinks(items => ({ ...items, [storyId]: url }));
      await copyLink(url);
      setNotice('7 gün geçerli hikâye daveti oluşturuldu ve kopyalandı.');
    }
    setStoryBusy(false);
  }

  async function createChapter(event) {
    event.preventDefault();
    if (!activeStory || !newChapterTitle.trim()) return;
    setStoryBusy(true);
    const { data, error } = await supabase.from('chapters').insert({
      story_id: activeStory.id, title: newChapterTitle.trim(),
      content: '', status: 'draft', created_by: userId,
      sort_order: chapters.length ? Math.max(...chapters.map(item => item.sort_order || 0)) + 1 : 1
    }).select().single();
    if (error) setNotice('Bölüm oluşturulamadı: ' + error.message);
    else {
      setChapters(items => [...items, data]);
      setActiveChapterId(data.id);
      setNewChapterTitle('');
      setEditorTitle(data.title);
      setEditorBlocks([]);
      setEditorContent('');
      setEditorStatus('draft');
      setEditorDirty(false);
      setShowRevisions(false);
      setFocusMode(true);
      setNotice('Yeni bölüm açıldı. Yazmaya başlayabilirsin.');
    }
    setStoryBusy(false);
  }

  async function saveChapter(event) {
    event.preventDefault();
    if (!activeChapter || !editorTitle.trim()) return;
    if(draftSaveTimerRef.current)window.clearTimeout(draftSaveTimerRef.current);
    setBusy(true);
    const richCanvas = document.querySelector('.writer-rich-canvas');
    let blocksToSave = editorBlocks.map(block => ({ id: block.id || null, content: block.content }));
    if (richCanvas) {
      const usedIds = new Set();
      blocksToSave = readWriterCanvasBlocks(richCanvas, userId).map(block => {
        const id = block.id && !usedIds.has(block.id) ? block.id : null;
        if (id) usedIds.add(id);
        return { id, content: block.content };
      });
    }
    if (!blocksToSave.length && editorContent.trim()) {
      blocksToSave = editorContent.split(/\n\s*\n/).filter(text => text.trim())
        .map(content => ({ id: null, content: content.trimEnd() }));
    }
    if (!blocksToSave.length && editorBlocks.length) {
      blocksToSave = editorBlocks.filter(block => String(block.content || '').trim())
        .map(block => ({ id: block.id || null, content: block.content }));
    }
    if (!blocksToSave.length) {
      setNotice('Metin alanı boş görünüyor. Yazdığın metni kontrol et; boş içerik kaydedilmedi.');
      setBusy(false);
      return;
    }
    const { error } = await supabase.rpc('save_chapter_blocks', {
      p_chapter_id: activeChapter.id, p_title: editorTitle.trim(), p_status: editorStatus,
      p_blocks: blocksToSave
    });
    const { data } = error ? { data: null } : await supabase.from('chapters').select('*').eq('id', activeChapter.id).single();
    if (error) setNotice('Bölüm kaydedilemedi: ' + error.message);
    else {
      setChapters(items => items.map(item => item.id === data.id ? data : item));
      window.localStorage.removeItem('ortak_roman_draft:'+userId+':'+activeChapter.id);
      await supabase.from('chapter_drafts').delete().eq('chapter_id',activeChapter.id).eq('user_id',userId);
      await loadChapterBlocks(activeChapter.id);
      setEditorDirty(false);setDraftSaveState('idle');
      const { error: releaseError } = await supabase.rpc('release_chapter_writing_lock', { p_chapter_id: activeChapter.id });
      if (releaseError) setNotice('Bölüm kaydedildi ancak yazma kilidi bırakılamadı: ' + releaseError.message);
      else setNotice('Bölüm kaydedildi ve artık diğer yazarların okumasına açıldı.');
      setFocusMode(false);
      setWritingLock(null);
      setLoadingChapterContent(false);
    }
    setBusy(false);
  }

  async function openChapter(chapter) {
    if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Bölüm değiştirmek istiyor musun?')) return;
    setWritingLock(null); setLoadingChapterContent(false);
    setEditorBlocks([]); setEditorContent('');
    setEditorTitle(chapter.title || ''); setEditorStatus(chapter.status || 'draft');
    setActiveChapterId(chapter.id); setEditorDirty(false); setShowRevisions(false); setFocusMode(false);
  }

  async function deleteChapter() {
    if (!activeChapter || !isStoryOwner) return;
    if (!window.confirm('Bu bölümü ve sürüm geçmişini silmek istediğine emin misin?')) return;
    const { error } = await supabase.from('chapters').delete().eq('id', activeChapter.id);
    if (error) setNotice('Bölüm silinemedi: ' + error.message);
    else {
      setChapters(items => items.filter(item => item.id !== activeChapter.id));
      setActiveChapterId('');
      setEditorDirty(false);
      setNotice('Bölüm silindi.');
    }
  }

  async function loadRevisions() {
    if (!activeChapter) return;
    const { data, error } = await supabase.from('chapter_revisions')
      .select('id,title,content,editor_id,created_at')
      .eq('chapter_id', activeChapter.id).order('created_at', { ascending: false }).limit(20);
    if (error) setNotice('Sürüm geçmişi yüklenemedi: ' + error.message);
    else {
      setRevisions(data || []);
      setShowRevisions(true);
    }
  }

  async function restoreRevision(revision) {
    if (!activeChapter || !window.confirm('Bu eski sürümü bölümün güncel içeriği olarak geri yüklemek istiyor musun?')) return;
    setBusy(true);
    const restoredBlocks = revision.content.split(/\n\s*\n/).filter(text => text.trim()).map(content => ({id:null,content}));
    const { error } = await supabase.rpc('save_chapter_blocks', {
      p_chapter_id: activeChapter.id, p_title: revision.title, p_status: activeChapter.status,
      p_blocks: restoredBlocks
    });
    const { data } = error ? { data: null } : await supabase.from('chapters').select('*').eq('id', activeChapter.id).single();
    if (error) setNotice('Sürüm geri yüklenemedi: ' + error.message);
    else {
      setChapters(items => items.map(item => item.id === data.id ? data : item));
      setEditorTitle(data.title);
      setEditorContent(data.content);
      await loadChapterBlocks(activeChapter.id);
      setEditorStatus(data.status);
      setEditorDirty(false);
      setNotice('Önceki sürüm geri yüklendi.');
      await loadRevisions();
    }
    setBusy(false);
  }

  async function saveStoryTitle(event) {
    event.preventDefault();
    if (!activeStory || !isStoryOwner || !storyTitleDraft.trim()) return;
    setStoryTitleBusy(true);
    const { data, error } = await supabase.from('stories').update({ title: storyTitleDraft.trim(), updated_at: new Date().toISOString() }).eq('id', activeStory.id).select().single();
    if (error) setNotice('Hikâye adı güncellenemedi: ' + error.message);
    else { setStories(items => items.map(item => item.id === data.id ? data : item)); setNotice('Hikâye adı güncellendi.'); }
    setStoryTitleBusy(false);
  }

  async function saveBookSettings(event) {
    event.preventDefault();
    if (role !== 'owner' || !book?.id) return;
    const targetWords = Number(settings.target_words);
    const extensionWords = Number(settings.extension_words);
    if (!Number.isInteger(targetWords) || targetWords < 100 || !Number.isInteger(extensionWords) || extensionWords < 100) {
      setNotice('Kelime hedefleri en az 100 ve tam sayı olmalı.');
      return;
    }
    setSettingsBusy(true);
    const { data, error } = await supabase.from('books').update({
      title: settings.title.trim() || 'Ortak Roman', subtitle: settings.subtitle.trim(),
      note: settings.note.trim(), target_words: targetWords, extension_words: extensionWords,
      updated_at: new Date().toISOString()
    }).eq('id', book.id).select().single();
    if (error) setNotice('Kitap ayarları kaydedilemedi: ' + error.message);
    else {
      setBook(data);
      setSettingsDirty(false);
      setNotice('Kitap ayarları kaydedildi.');
    }
    setSettingsBusy(false);
  }

  if (session && !authorized) {
    return <div className="setup"><div className="setup-card">
      <small>ORTAK ROMAN · HİKÂYE ERİŞİMİ</small>
      <h1>Hesabın henüz bir hikâyeye bağlı değil</h1>
      <p>{notice || 'Bu alan yalnızca hikâye üyelerine açıktır.'}</p>
      <p>Bir yazarın gönderdiği hikâye davet bağlantısını açıp e-posta girişini yeniden tamamla.</p>
      <button className="button light" onClick={() => supabase.auth.signOut()}>Çıkış yap</button>
    </div></div>;
  }

  const totalWords = chapters.reduce((sum, item) => sum + words(item.content || ''), 0);
  const publishedChapters = chapters.filter(item => item.status === 'published').length;
  const storyWordCount = chapters.reduce((sum,item) => sum + words(item.id === activeChapterId ? editorContent : (item.content || '')),0);
  const chapterWordLimit = activeChapter?.target_words || 1000;
  const chapterOverLimit = Boolean(activeChapter && words(editorContent) > chapterWordLimit);


  function turnBookPage(direction) {
    if (readerTurn || readerTurnTimerRef.current !== null || effectiveReaderLayout === 'scroll' || !readerPages.length) return;
    const nextIndex = readerPageIndex + direction * readerPageStep;
    if (nextIndex < 0 || nextIndex > readerMaxPageIndex) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setReaderPageIndex(nextIndex);
      return;
    }
    setReaderTurn(direction > 0 ? 'forward' : 'backward');
    readerTurnTimerRef.current = window.setTimeout(() => {
      setReaderPageIndex(nextIndex);
      setReaderTurn(null);
      readerTurnTimerRef.current = null;
    }, 520);
  }

  async function exitWritingStudio() {
    if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Yazma alanından çıkmak istiyor musun?')) return;
    // Release the chapter immediately before leaving so the next writer does not
    // have to wait for the lease timeout.
    if (writingLock?.acquired && activeChapterId) {
      const { error } = await supabase.rpc('release_chapter_writing_lock', { p_chapter_id: activeChapterId });
      if (error) {
        setNotice('Yazma kilidi bırakılamadı. Diğer yazarın erişimi kısa süre sonra otomatik açılacak: ' + error.message);
      }
    }
    setFocusMode(false);
    setWritingLock(null);
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href={window.location.pathname}>✦ ORTAK <b>ROMAN</b></a>
      {session ? <div className="account"><button className="text-button" onClick={()=>setView('home')}>Ana sayfa</button><button className="text-button" onClick={()=>setView('discover')}>Yazarları keşfet</button><button className="button light profile-nav-button" disabled={profileBusy} onClick={() => openProfile()}>{profileBusy ? 'Açılıyor…' : 'Profilim'}</button><button className="button light" onClick={() => supabase.auth.signOut()}>Çıkış</button></div> : <span className="eyebrow">DAVETLİ YAZARLAR</span>}
    </header>    <main className={session ? 'content workspace-content' : 'content login-content'}>
      {!session ? <div className="login-layout">
        <section className="login-hero">
          <div className="login-hero-copy">
            <span className="eyebrow">BİRLİKTE YAZILAN BİR HİKÂYE</span>
            <h1>Her hikâye<br/><em>bir sesle</em> başlar.</h1>
            <p>Farklı zihinler, tek bir sayfada buluşur. Sen de davet edildiğin hikâyeye katıl; bir sonraki cümleyi birlikte yazalım.</p>
            <div className="login-signature"><span>✳</span> Bir hikâye, birçok ses</div>
          </div>
          <div className="book-art" aria-hidden="true">
            <div className="book-art-glow"></div><div className="book-sheet sheet-back"></div>
            <div className="book-sheet sheet-front"><span>ORTAK ROMAN</span><i>“</i><strong>Bir hikâye,<br/>birçok ses.</strong><small>İLK SAYFA HENÜZ YAZILMADI</small></div>
            <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span>
          </div>
        </section>
        <section className="panel login-panel">
          <div className="login-panel-mark">✦</div><span className="eyebrow">DAVETLİ YAZARLAR İÇİN</span>
          <h2>Hikâyeye katıl.</h2>
          <p>{window.localStorage.getItem('ortak_roman_story_invite') ? 'Davet bağlantın doğrulandığında e-posta gerektirmeden hikâyeye katılabilirsin.' : 'Katılmak için sana gönderilen geçerli hikâye davet bağlantısını açmalısın.'}</p>
          <form onSubmit={signIn} className="login-form">
            {window.localStorage.getItem('ortak_roman_story_invite') ? <>
              <label htmlFor="login-name">YAZAR ADIN (İSTEĞE BAĞLI)</label>
              <input id="login-name" type="text" maxLength={24} placeholder="Nasıl görünmek istersin?" value={name} onChange={e => setName(e.target.value)} />
              <button className="button" disabled={busy}>{busy ? 'Katılınıyor…' : 'Davetle hikâyeye katıl'} <span>→</span></button>
            </> : window.localStorage.getItem('ortak_roman_bootstrap') === '1' ? <>
              <label htmlFor="login-email">YÖNETİCİ E-POSTA ADRESİ</label>
              <input id="login-email" type="email" required placeholder="ornek@eposta.com" value={email} onChange={e => setEmail(e.target.value)} />
              <button className="button" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Yönetici giriş bağlantısı gönder'} <span>→</span></button>
            </> : <button className="button" type="button" disabled>Önce davet bağlantısını aç</button>}
          </form>
          <div className="login-footnote"><span>◈</span> Davet bağlantısına sahip olan herkes katılabilir; e-posta onayı gerekmez.</div>
        </section>
      </div> : <>
        {view === 'profile' ? <section className="profile-page">
          <div className="profile-page-heading"><button className="text-button" onClick={() => setView('workspace')}>← Çalışma alanına dön</button><span className="eyebrow">ORTAK ROMAN · YAZAR KARTI</span></div>
          <div className="profile-hero"><div className="profile-avatar">{(profile?.display_name || 'Y').slice(0,1).toLocaleUpperCase('tr-TR')}</div><div className="profile-identity"><span className="eyebrow">YAZAR · TOPLULUK PROFİLİ</span><h1>{profile?.display_name || 'Yazar'}</h1>{profile?.bio && <p className="profile-bio">{profile.bio}</p>}<p>Katılım: {profile?.member_since ? new Date(profile.member_since).toLocaleDateString('tr-TR',{year:'numeric',month:'long'}) : 'Yeni yazar'}</p><div className="profile-social-counts"><span><b>{profile?.followers_count ?? 0}</b> takipçi</span><span><b>{profile?.following_count ?? 0}</b> takip</span></div></div>{publicProfileId !== userId && <button className="button profile-follow-button" onClick={() => toggleFollow(publicProfileId,profile?.is_following)}>{profile?.is_following ? 'Takibi bırak' : '+ Takip et'}</button>}</div>
          <div className="profile-stats-grid">
            <article><strong>{profile?.stats?.stories_created ?? 0}</strong><span>Hikâye başlattı</span></article>
            <article><strong>{profile?.stats?.stories_joined ?? 0}</strong><span>Hikâyeye katıldı</span></article>
            <article><strong>{profile?.stats?.chapters_written ?? 0}</strong><span>Bölüm oluşturdu</span></article>
            <article><strong>{Number(profile?.stats?.words_authored_current || 0).toLocaleString('tr-TR')}</strong><span>Yazdığı paragraflardaki kelime</span></article>
            <article><strong>{profile?.stats?.paragraphs_written ?? 0}</strong><span>Yazdığı paragraf</span></article>
            <article><strong>{profile?.stats?.paragraphs_last_edited ?? 0}</strong><span>Başkasının paragrafına katkı</span></article>
            <article><strong>{profile?.stats?.writers_invited ?? 0}</strong><span>Davetle katılan yazar</span></article>
            <article><strong>{profile?.stats?.invite_links_created ?? 0}</strong><span>Davet bağlantısı oluşturdu</span></article>
            <article><strong>{profile?.stats?.chapter_edits ?? 0}</strong><span>Bölüm düzenlemesi</span></article>
            <article><strong>{profile?.stats?.sentences_highlighted ?? 0}</strong><span>Altını çizdiği cümle</span></article>
          </div>
          <p className="profile-stat-note">Kelime sayısı, ilk yazarı olduğun paragrafların güncel metninden hesaplanır; paragrafı sonradan düzenleyen kişinin eklediği veya çıkardığı kelimeler ayrı hesaplanmaz. Eski metinlerin yazarı bilinmediği için katkı istatistiklerine dahil edilmez. Altını çizdiğin cümleler ortak metinde görünür ve yazar profiline sayılır.</p>
          {publicProfileId === userId && <form className="profile-edit-card" onSubmit={saveProfile}>
            <div><span className="eyebrow">KİŞİSEL ALAN</span><h2>Profilini düzenle</h2><p>Diğer hikâye üyeleri adını ve kısa tanıtımını görebilir.</p></div>
            <label>Görünen ad<input required minLength={2} maxLength={40} value={profileForm.display_name} onChange={e => setProfileForm(v => ({...v,display_name:e.target.value}))}/></label>
            <label>Hakkımda<textarea rows={4} maxLength={500} value={profileForm.bio} onChange={e => setProfileForm(v => ({...v,bio:e.target.value}))} placeholder="Kendinden ve yazmayı sevdiğin hikâyelerden bahset…"/></label>
            <div className="profile-edit-footer"><span>{profileForm.bio.length}/500</span><button className="button" disabled={profileBusy || !profileForm.display_name.trim()}>{profileBusy ? 'Kaydediliyor…' : 'Profili kaydet'}</button></div>
          </form>}
        </section> : view === 'discover' ? <section className="discover-page">
          <div className="discover-heading"><span className="eyebrow">ORTAK ROMAN TOPLULUĞU</span><h1>Yazarları keşfet.</h1><p>Yeni sesler bul, yazarları takip et ve birlikte yazacağın insanlarla tanış.</p><input value={authorQuery} onChange={e => {setAuthorQuery(e.target.value);loadDiscover(e.target.value);}} placeholder="Yazar veya ilgi alanı ara…" aria-label="Yazar ara"/></div>
          <div className="discover-grid">{discoverAuthors.map(author => <article className="author-card" key={author.id}><button className="author-card-main" onClick={() => openProfile(author.id)}><span className="profile-avatar">{(author.display_name || 'Y').slice(0,1).toLocaleUpperCase('tr-TR')}</span><strong>{author.display_name}</strong><p>{author.bio || 'Henüz kendini tanıtmadı.'}</p><small>{author.followers_count} takipçi · {author.following_count} takip</small></button><div className="author-card-actions"><button className="button light" onClick={() => openProfile(author.id)}>Profili gör</button><button className="button" onClick={() => toggleFollow(author.id,author.is_following)}>{author.is_following ? 'Takibi bırak' : 'Takip et'}</button></div></article>)}</div>
          {!discoverAuthors.length && <div className="chapter-empty"><span>✦</span><h2>Henüz eşleşen yazar yok.</h2><p>Başka bir isimle ara veya topluluğa yeni yazarlar davet et.</p></div>}
        </section> : view === 'reader' ? <section className="reader-page">
          <div className="reader-topline"><button className="text-button" onClick={() => setView('workspace')}>← Çalışma alanı</button><span className="eyebrow">ORTAK ROMAN · KİTAP OKUYUCU</span><button className="text-button" onClick={() => setView('home')}>Kitaplığıma dön</button></div>
          <div className="reader-toolbar">
            <label>BÖLÜM <select value={readerChapter?.id || ''} onChange={e=>{const index=readerChapters.findIndex(item=>item.id===e.target.value);setReadingIndex(Math.max(0,index));setReaderPageIndex(0);}}>{readerChapters.map((chapter,index)=><option key={chapter.id} value={chapter.id}>{String(index+1).padStart(2,'0')} · {chapter.title}{chapter.status==='published'?'':' · Çalışma nüshası'}</option>)}</select></label>
            <label>OKUMA DÜZENİ <select value={readerLayout} onChange={e=>{setReaderLayout(e.target.value);setReaderPageIndex(0);setReaderTurn(null);}}><option value="spread">Açık kitap · iki sayfa</option><option value="single">Tek sayfa</option><option value="scroll">Kesintisiz kaydırma</option></select></label>
            {isCompactReader && readerLayout === 'spread' && <small className="reader-responsive-note">Mobil ekranda rahat okuma için tek sayfa gösteriliyor.</small>}
          </div>
          <div className={'reader-book reader-layout-' + effectiveReaderLayout}>
            <div className="reader-running-head"><span>{book?.title || 'Ortak Roman'}</span><span>{activeStory?.title || ''}</span></div>
            <section className="reader-frontmatter">
              <span className="reader-front-kicker">ORTAK ROMAN · BİRLİKTE YAZILAN BİR KİTAP</span>
              <div className="reader-front-cover"><span className="reader-front-symbol">✦</span><h1>{book?.title || 'Ortak Roman'}</h1>{book?.subtitle && <p className="reader-front-subtitle">{book.subtitle}</p>}<div className="reader-front-rule"/><h2>{activeStory?.title || 'Hikâye'}</h2>{book?.note && <p className="reader-front-description">{book.note}</p>}<div className="reader-front-authors"><small>YAZARLAR</small><strong>{readerAuthors.length ? readerAuthors.join(' · ') : 'Ortak yazarlar'}</strong></div><small className="reader-front-date">{chapters.some(item=>item.status==='published'&&String(item.content||'').trim()) ? 'YAYIN TARİHİ · ' + new Date(chapters.filter(item=>item.status==='published'&&String(item.content||'').trim()).sort((a,b)=>new Date(a.updated_at)-new Date(b.updated_at))[0].updated_at).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : 'OLUŞTURULMA TARİHİ · ' + (activeStory?.created_at ? new Date(activeStory.created_at).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : 'Tarih belirtilmedi')}</small></div>
            </section>
            {!readerChapter ? <div className="reader-empty"><span>✦</span><h2>Henüz okunabilir kayıtlı metin yok.</h2><p>Yazarlar metinlerini kaydettikçe yayın öncesinde de burada birlikte okuyabilirsiniz.</p></div> : effectiveReaderLayout === 'scroll' ? <article className="reader-scroll-sheet" onScroll={event=>{const position=Math.max(0,Math.round(event.currentTarget.scrollTop));if(readerProgressTimerRef.current)window.clearTimeout(readerProgressTimerRef.current);readerProgressTimerRef.current=window.setTimeout(()=>supabase.from('reading_progress').upsert({user_id:userId,story_id:activeStoryId,chapter_id:readerChapter.id,page_index:0,reader_layout:'scroll',scroll_position:position},{onConflict:'user_id,story_id'}),300);}}>
              <span className="eyebrow">BÖLÜM {String(readingIndex+1).padStart(2,'0')} · {readerChapter.status==='published'?'YAYINDA':'ÇALIŞMA NÜSHASI · YAYINLANMADI'}</span><h1>{readerChapter.title}</h1>
              <div className="reader-prose">{readerChapter.content.split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{renderReaderHighlightedText(paragraph, sentenceHighlights)}</p>)}</div>
            </article> : <div className={'reader-spread' + (readerTurn ? ' turning-' + readerTurn : '')}>
              <article className="reader-page-sheet page-left">
                <span className="reader-page-kicker">{readerPageIndex === 0 ? readerChapter.title : 'ORTAK ROMAN'}{readerChapter.status!=='published'?' · ÇALIŞMA NÜSHASI':''}</span>
                <div className="reader-page-prose" ref={readerPageMeasureRef}>{(readerPages[readerPageIndex] || '').split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
                <span className="reader-page-number">{readerPageIndex+1}</span>
              </article>
              <article className="reader-page-sheet page-right">
                <span className="reader-page-kicker">{readerChapter.title}</span>
                <div className="reader-page-prose">{(readerPages[readerPageIndex+1] || '').split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
                <span className="reader-page-number">{Math.min(readerPageIndex+2,readerPages.length)}</span>
              </article>
              {readerTurn && <div className={'page-flip-overlay ' + readerTurn}><div className="page-flip-front"><span>{readerChapter.title}</span><p>{(readerPages[readerTurn==='forward'?readerPageIndex+1:readerPageIndex] || '').slice(0,450)}</p></div><div className="page-flip-back"></div></div>}
            </div>}
            <div className="reader-controls">
              <button className="button light" disabled={readingIndex===0 && readerPageIndex===0} onClick={()=>{if(effectiveReaderLayout!=='scroll' && readerPageIndex>0)turnBookPage(-1);else if(readingIndex>0){setReadingIndex(i=>i-1);setReaderPageIndex(0);}}}>← Önceki</button>
              <span aria-live="polite" aria-atomic="true">{effectiveReaderLayout==='scroll' ? 'Bölüm '+(readingIndex+1)+' / '+readerChapters.length : 'Sayfa '+(Math.min(readerPageIndex+1,readerPages.length)||0)+'–'+(Math.min(readerPageIndex+readerPageStep,readerPages.length)||0)+' / '+readerPages.length}</span>
              <button className="button" disabled={readingIndex>=readerChapters.length-1 && (effectiveReaderLayout==='scroll' || readerPageIndex>=readerMaxPageIndex)} onClick={()=>{if(effectiveReaderLayout!=='scroll' && readerPageIndex<readerMaxPageIndex)turnBookPage(1);else if(readingIndex<readerChapters.length-1){setReadingIndex(i=>i+1);setReaderPageIndex(0);}}}>Sonraki →</button>
            </div>
          </div>
        </section> : view === 'home' ? <section className="home-page">
          <div className="home-welcome"><div><span className="eyebrow">KİTAPLIĞIN · YAZAR TOPLULUĞU</span><h1>Her kitabın<br/><em>bir başlangıcı</em> vardır.</h1><p>Bir hikâyeyi tek başına başlatabilir, başka yazarlarla birlikte büyütebilirsin.</p><div className="home-actions"><button className="button" onClick={()=>setView('workspace')}>Yazmaya devam et <span>→</span></button><button className="button light" onClick={()=>setView('reader')}>Kitabı oku</button></div></div><div className="home-book-object"><div className="home-book-spine"></div><div className="home-book-cover"><small>ORTAK ROMAN</small><span>✦</span><strong>{book?.title || 'Bir hikâye, birçok ses'}</strong><i>Birlikte yazılan hikâyeler</i></div></div></div>
          <div className="home-section-head"><div><span className="eyebrow">SENİN KÜTÜPHANEN</span><h2>Hikâyelerine dön</h2></div><button className="text-button" onClick={()=>setView('workspace')}>Tüm hikâyeler →</button></div>
          <div className="home-story-grid">{stories.slice(0,3).map((story,i)=><button className={'home-story-card cover-tone-'+i} key={story.id} onClick={()=>{setActiveStoryId(story.id);setView('workspace');}}><span>✦</span><strong>{story.title}</strong><small>{story.description || 'Birlikte yazılmayı bekleyen bir hikâye'}</small></button>)}{!stories.length&&<p className="empty-small">Henüz hikâyen yok. Çalışma alanından ilk hikâyeni oluştur.</p>}</div>
          <div className="home-community-strip"><div><span className="eyebrow">YAZAR TOPLULUĞU</span><h2>Yeni bir ses keşfet.</h2><p>Yazarları bul, takip et ve hikâyelerine davet et.</p></div><button className="button" onClick={()=>setView('discover')}>Yazarları keşfet →</button></div>
        </section> : <>
        <section className="workspace-heading">
          <div><span className="eyebrow">YAZAR ÇALIŞMA ALANI</span><h1>{book?.title || 'Ortak Roman'}</h1><p>{book?.subtitle || 'Bir hikâye, birçok ses'}</p></div>
          <div className="workspace-stats"><strong>{stories.length}</strong><span>hikâye</span><i></i><strong>{publishedChapters}</strong><span>yayındaki bölüm</span></div>
        </section>
        <section className="workspace-grid">
          <aside className="workspace-sidebar">
            <div className="sidebar-heading"><div><span className="eyebrow">KÜTÜPHANE</span><h2>Hikâyeler</h2></div><span className="story-count">{stories.length}</span></div>
            <div className="story-nav">
              {stories.map(story => <button key={story.id} className={'story-nav-item' + (story.id === activeStoryId ? ' active' : '')} onClick={() => {
                if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Hikâye değiştirmek istiyor musun?')) return;
                setEditorDirty(false); setActiveStoryId(story.id); setShowRevisions(false);
              }}>
                <span className="story-nav-icon">✳</span><span><strong>{story.title}</strong><small>{story.owner_id === userId ? 'Senin hikâyen' : 'Katıldığın hikâye'}</small></span>
              </button>)}
              {!stories.length && <p className="empty-small">Henüz hikâye yok. İlk hikâyeni oluştur.</p>}
            </div>
            {activeStory && <div className="sidebar-invite">
              <button className="button light full" disabled={storyBusy} onClick={() => makeStoryInvite(activeStory.id)}>↗ Yazar davet et</button>
              {storyInviteLinks[activeStory.id] && <div className="story-link-copy"><input readOnly value={storyInviteLinks[activeStory.id]} onFocus={e => e.target.select()} /><button className="button light" onClick={() => copyLink(storyInviteLinks[activeStory.id])}>Kopyala</button></div>}
            </div>}
            <div className="new-story">
              <span className="eyebrow">YENİ BİR BAŞLANGIÇ</span>
              <form onSubmit={createStory}>
                <input required maxLength={120} value={newStoryTitle} onChange={e => setNewStoryTitle(e.target.value)} placeholder="Hikâyenin adı" aria-label="Yeni hikâye adı"/>
                <textarea rows={2} maxLength={600} value={newStoryDescription} onChange={e => setNewStoryDescription(e.target.value)} placeholder="Kısa açıklama (isteğe bağlı)" aria-label="Hikâye açıklaması"/>
                <button className="button full" disabled={storyBusy || !newStoryTitle.trim() || !book?.id}>{storyBusy ? 'Oluşturuluyor…' : '+ Hikâye oluştur'}</button>
              </form>
            </div>
          </aside>

          <section className="workspace-main">
            {activeStory ? <>
              <div className="story-heading">
                <div><span className="eyebrow">SEÇİLİ HİKÂYE</span>{isStoryOwner ? <form className="story-title-edit" onSubmit={saveStoryTitle}><input aria-label="Hikâye adı" maxLength={120} value={storyTitleDraft} onChange={e=>setStoryTitleDraft(e.target.value)} /><button className="button light" disabled={storyTitleBusy || !storyTitleDraft.trim() || storyTitleDraft.trim()===activeStory.title}>{storyTitleBusy?'Kaydediliyor…':'Adı kaydet'}</button></form> : <h2>{activeStory.title}</h2>}<p>{activeStory.description || 'Bu hikâyenin dünyası henüz tanımlanmadı.'}</p></div>
                <div className="story-heading-actions"><span className="story-word-meter">{chapters.reduce((n,c)=>n+words(c.content||''),0).toLocaleString('tr-TR')} / {(activeStory.target_words||10000).toLocaleString('tr-TR')} kelime</span><button className="button light" onClick={()=>{setReadingIndex(0);setReaderPageIndex(0);setView('reader');}}>Kitabı oku</button><span className={'status-pill ' + activeStory.status}>{activeStory.status === 'published' ? 'Yayında' : activeStory.status === 'archived' ? 'Arşiv' : 'Taslak'}</span><button className="button light" disabled={storyBusy} onClick={() => makeStoryInvite(activeStory.id)}>Davet bağlantısı</button>{isStoryOwner && <button className="button light danger-button" disabled={storyBusy} onClick={deleteStory}>Hikâyeyi sil</button>}</div>
              </div>

              {isStoryOwner && <div className="story-target-control"><label>Hikâye kelime hedefi <input type="number" min="100" max="1000000" step="100" value={activeStory.target_words || 10000} onChange={e=>{const target_words=Number(e.target.value);setStories(items=>items.map(s=>s.id===activeStory.id?{...s,target_words}:s));}} onBlur={async e=>{const {error}=await supabase.from('stories').update({target_words:Number(e.target.value),updated_at:new Date().toISOString()}).eq('id',activeStory.id);if(error)setNotice('Hedef güncellenemedi: '+error.message);else setNotice('Hikâye kelime hedefi güncellendi.');}}/></label><span>{storyWordCount.toLocaleString('tr-TR')} / {(activeStory.target_words||10000).toLocaleString('tr-TR')} kelime · Hikâyedeki tüm bölümlerin toplamı</span></div>}
              <div className="chapter-layout">
                <aside className="chapter-sidebar">
                  <div className="chapter-sidebar-title"><h3>Bölümler</h3><span>{chapters.length}</span></div>
                  {chapters.map((chapter,index) => { const presence = activeWritingLocks[chapter.id]; const isOtherWriter = presence && presence.user_id !== userId; return <button key={chapter.id} className={'chapter-nav-item' + (chapter.id === activeChapterId ? ' active' : '') + (presence ? ' is-being-written' : '')} onClick={() => openChapter(chapter)}>
                    <small>{String(index+1).padStart(2,'0')}</small><span><strong>{chapter.title}</strong><em>{isOtherWriter ? '✎ Şu an yazıyor: ' + presence.display_name : (presence?.user_id === userId ? '✎ Şu an sen yazıyorsun' : (chapter.status === 'published' ? 'Yayında' : 'Taslak'))}</em></span>{isOtherWriter && <i className="chapter-live-dot" aria-label="Yazılıyor"/>}
                  </button>; })}
                  {!chapters.length && <p className="empty-small">Bu hikâyede henüz bölüm yok.</p>}
                  <form className="new-chapter-form" onSubmit={createChapter}>
                    <input required maxLength={120} value={newChapterTitle} onChange={e => setNewChapterTitle(e.target.value)} placeholder="Yeni bölüm başlığı" aria-label="Yeni bölüm başlığı"/>
                    <button className="button light full" disabled={storyBusy || !newChapterTitle.trim()}>+ Bölüm ekle</button>
                  </form>
                </aside>

                <div className={'chapter-editor-wrap' + (focusMode ? ' focus-mode focus-width-' + writingWidth : '')}>
                  {activeChapter ? <form className="chapter-editor" onSubmit={saveChapter}>
                    <div className="editor-toolbar">
                      {focusMode ? <div className="writer-studio-brand"><button type="button" className="writer-back-button" onClick={exitWritingStudio} aria-label="Çalışma alanına dön">←</button><div><span className="writer-studio-book">{activeStory?.title || 'Ortak Roman'}</span><strong>{editorTitle || 'Yeni bölüm'}</strong></div></div> : <span className="eyebrow">BÖLÜM DÜZENLEYİCİ</span>}
                      <div className="writer-toolbar-actions">
                        <span className="save-state">{draftSaveState==='pending'?'Otomatik taslak kaydediliyor…':draftSaveState==='saved'?'✓ Kişisel taslağın korundu':draftSaveState==='device-only'?'✓ Cihazda korundu':editorDirty?'● Ortak okumaya henüz aktarılmadı':'✓ Ortak metin kaydedildi'}</span>
                        {focusMode ? <button type="button" className="writer-exit-button" onClick={exitWritingStudio}>Çalışma alanına dön</button> : <button type="button" className="text-button" disabled={Boolean(activeWritingLocks[activeChapterId] && activeWritingLocks[activeChapterId].user_id !== userId)} onClick={() => {setLoadingChapterContent(true);setFocusMode(true);}}>⛶ Yazmaya devam et</button>}
                        {isStoryOwner && !focusMode && <button type="button" className="text-button danger" onClick={deleteChapter}>Bölümü sil</button>}
                      </div>
                    </div>
                    {focusMode && <div className="focus-width-controls">
                      <div className="writer-format-group">
                        <label>YAZI <select value={writingFont} onChange={e=>setWritingFont(e.target.value)}><option value="serif">Kitap serif</option><option value="sans">Modern</option><option value="typewriter">Daktilo</option></select></label>
                        <label>PUNTO <select value={writingSize} onChange={e=>setWritingSize(e.target.value)}><option value="17">17</option><option value="18">18</option><option value="20">20</option><option value="22">22</option><option value="24">24</option></select></label>
                        <label>SATIR <select value={writingLineHeight} onChange={e=>setWritingLineHeight(e.target.value)}><option value="1.6">Sıkı</option><option value="1.8">Normal</option><option value="1.95">Rahat</option><option value="2.1">Geniş</option></select></label>
                      </div>
                      <div className="writer-layout-group"><button type="button" className={writingWidth === 'notebook' ? 'active' : ''} onClick={() => setWritingWidth('notebook')}>Defter</button><button type="button" className={writingWidth === 'wide' ? 'active' : ''} onClick={() => setWritingWidth('wide')}>Word</button><button type="button" className={writingWidth === 'book' ? 'active' : ''} onClick={() => setWritingWidth('book')}>Kitap</button></div>
                      <div className="sentence-highlight-actions">
                        <button type="button" className="sentence-highlight-button" disabled={!selectedSentence || !writingLock?.acquired} onMouseDown={e=>e.preventDefault()} onClick={addSentenceHighlight}>↗ Cümlenin altını çiz</button>
                        <span>{sentenceHighlights.length} cümle vurgusu</span>
                      </div>
                      <span className="focus-word-count">{words(editorContent).toLocaleString('tr-TR')} kelime</span>
                    </div>}
                    <input className="chapter-title-input" required maxLength={120} disabled={!writingLock?.acquired} value={editorTitle} onChange={e => {setEditorTitle(e.target.value);setEditorDirty(true);}} aria-label="Bölüm başlığı" placeholder="Bölüm başlığı"/>
                    <div className="editor-meta"><span>{words(editorContent).toLocaleString('tr-TR')} / {(activeChapter.target_words||1000).toLocaleString('tr-TR')} kelime</span><label>Durum <select disabled={!writingLock?.acquired} value={editorStatus} onChange={e => {setEditorStatus(e.target.value);setEditorDirty(true);}}><option value="draft">Taslak</option><option value="published">Yayında</option></select></label><label>Bölüm hedefi <input className="inline-word-target" type="number" min="100" max="100000" step="100" value={activeChapter.target_words || 1000} onChange={async e=>{const target_words=Number(e.target.value);setChapters(items=>items.map(c=>c.id===activeChapter.id?{...c,target_words}:c));}} onBlur={async e=>{const {error}=await supabase.from('chapters').update({target_words:Number(e.target.value),updated_at:new Date().toISOString()}).eq('id',activeChapter.id);if(error)setNotice('Bölüm hedefi güncellenemedi: '+error.message);else setNotice('Bölüm kelime hedefi güncellendi.');}}/></label></div>
                    {chapterOverLimit && <div className="word-limit-warning">Bölüm kelime sınırını aştın. Kaydedebilmek için {Math.max(0,words(editorContent)-chapterWordLimit)} kelime azalt veya bölüm hedefini yükselt.</div>}
                    {writingLock && <div className={'writing-presence ' + (writingLock.acquired ? 'is-self' : 'is-other')}><span className="writing-pencil">✎</span>{writingLock.acquired ? 'Şu anda bu bölümü sen yazıyorsun. Sıra sende.' : (writingLock.display_name || 'Bir yazar') + ' şu anda yazıyor · Bu bölüm geçici olarak kilitli.'}</div>}
                    <div className={'chapter-blocks-editor' + (focusMode ? ' document-page-canvas' : '')} aria-label="Paragraf yazma alanı">
                      {focusMode && !writingLock ? <div className="private-writing-screen" role="status" aria-live="polite"><span className="eyebrow">YAZMA OTURUMU</span><h3>Yazma izni kontrol ediliyor…</h3><p>Bölümün kilit durumu doğrulanıyor.</p></div> : (focusMode && writingLock && !writingLock.acquired) || (!focusMode && (!writingPresenceReady || (activeWritingLocks[activeChapterId] && activeWritingLocks[activeChapterId].user_id !== userId))) ? <div className="private-writing-screen" role="status" aria-live="polite">
                          <div className="private-writing-animation"><span className="private-writing-pencil">✎</span><span className="private-writing-line line-one"/><span className="private-writing-line line-two"/><span className="private-writing-line line-three"/></div>
                          <span className="eyebrow">ÖZEL YAZIM ALANI</span>
                          <h3>{!writingPresenceReady && !focusMode ? 'Yazma durumu kontrol ediliyor…' : (writingLock?.display_name || activeWritingLocks[activeChapterId]?.display_name || 'Bir yazar') + ' şu anda yazıyor.'}</h3>
                          <p>Bu bölümün metni yazım tamamlanıp kaydedilene kadar diğer yazarlara gösterilmez.</p>
                          <span className="private-writing-lock">▣ Bölüm geçici olarak kilitli</span>
                        </div> : !focusMode ? <div className="chapter-read-preview"><span className="eyebrow">OKUMA ÖNİZLEMESİ</span>{editorBlocks.length ? editorBlocks.map((block,index)=><p key={block.id || 'preview-'+index}>{block.content}</p>) : <p className="chapter-preview-empty">Bu bölümde henüz kaydedilmiş metin yok. Yazmaya başlamak için “Odak modunda yaz” seçeneğini kullan.</p>}</div> : <div
                         className="writer-rich-canvas"
                        contentEditable={Boolean(writingLock?.acquired)}
                        suppressContentEditableWarning
                        role="textbox"
                        aria-label="Hikâye metni"
                        aria-multiline="true"
                        data-placeholder="Hikâyenin ilk cümlesini yaz…"
                        style={{fontFamily:writingFont==='sans'?'Arial, sans-serif':writingFont==='typewriter'?'Courier New, monospace':"'Literata', 'EB Garamond', Georgia, serif",fontSize:writingSize+'px',lineHeight:writingLineHeight}}
                        onInput={e=>{const nodes=readWriterCanvasBlocks(e.currentTarget,userId);setEditorContent(nodes.map(block=>block.content).join('\n\n'));setEditorDirty(true);}}
                        onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.currentTarget.closest('form')?.requestSubmit();}}}
                        onMouseUp={captureSentenceSelection}
                        onKeyUp={captureSentenceSelection}
                      >
                        {editorBlocks.map((block,index)=><p key={block.id || 'legacy-'+index} data-block-id={block.id || ''}>{block.content ? renderHighlightedText(block.content, block.id, sentenceHighlights) : <br/>}</p>)}
                      </div>}
                    </div>
                    <p className="editor-save-help">Otomatik taslak yalnızca senin için saklanır. Diğer yazarların da Kitabı oku alanında görebilmesi için <strong>Kaydet ve okumada göster</strong> düğmesine bas. Taslak durumundaki metin yalnızca hikâye üyelerine görünür.</p><div className="editor-footer"><button type="button" className="button light" onClick={loadRevisions}>Sürüm geçmişi</button><button className="button" disabled={busy || !writingLock?.acquired || chapterOverLimit || !editorTitle.trim() || !editorDirty}>{busy ? 'Kaydediliyor…' : 'Kaydet ve okumada göster'}</button></div>
                    {showRevisions && <div className="revision-list"><div className="revision-heading"><strong>Önceki sürümler</strong><button type="button" className="text-button" onClick={() => setShowRevisions(false)}>Kapat</button></div>
                      {revisions.length ? revisions.map(revision => <article key={revision.id}><div><strong>{revision.title}</strong><small>{new Date(revision.created_at).toLocaleString('tr-TR')} · {words(revision.content)} kelime</small></div><button type="button" className="button light" onClick={() => restoreRevision(revision)}>Geri yükle</button></article>) : <p>Henüz önceki bir sürüm yok.</p>}
                    </div>}
                  </form> : <div className="chapter-empty"><span>✳</span><h3>İlk bölümü yazmaya başla.</h3><p>Bu hikâyeye bir bölüm ekle; davet ettiğin yazarlar da birlikte geliştirebilir.</p></div>}
                </div>
              </div>
            </> : <div className="chapter-empty welcome-empty"><span>✦</span><h2>Bir hikâyeyle başlayalım.</h2><p>Soldaki alandan yeni bir hikâye oluştur. Her hikâyenin kendi yazarları, davetleri ve bölümleri olacak.</p></div>}
          </section>
        </section>
        {role === 'owner' && <section className="panel settings-panel workspace-settings">
          <span className="eyebrow">ANA YÖNETİCİ · KİTAP AYARLARI</span><h2>Kitap bilgileri</h2>
          <form onSubmit={saveBookSettings}>
            <label>Kitap başlığı<input required maxLength={100} value={settings.title} onChange={e => {setSettings(v => ({...v,title:e.target.value}));setSettingsDirty(true);}}/></label>
            <label>Alt başlık<input maxLength={160} value={settings.subtitle} onChange={e => {setSettings(v => ({...v,subtitle:e.target.value}));setSettingsDirty(true);}}/></label>
            <label>Kitap açıklaması<textarea rows={3} value={settings.note} onChange={e => {setSettings(v => ({...v,note:e.target.value}));setSettingsDirty(true);}}/></label>
            <div className="settings-numbers"><label>Kelime hedefi<input type="number" min="100" step="100" value={settings.target_words} onChange={e => {setSettings(v => ({...v,target_words:e.target.value}));setSettingsDirty(true);}}/></label><label>Uzatma miktarı<input type="number" min="100" step="100" value={settings.extension_words} onChange={e => {setSettings(v => ({...v,extension_words:e.target.value}));setSettingsDirty(true);}}/></label></div>
            <div className="settings-actions"><span>Değişiklikler tüm kitap alanına yansır.</span><button className="button" disabled={settingsBusy || !settingsDirty}>{settingsBusy ? 'Kaydediliyor…' : 'Ayarları kaydet'}</button></div>
          </form>
        </section>}
        </>}
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Bildirimi kapat">×</button></div>}
    </main>
    <footer className="site-footer">ORTAK ROMAN <span>Birlikte yazılır.</span></footer>
  </div>;
}