import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { GoogleGenAI } from "@google/genai";
import { 
  Heart, 
  Settings, 
  Save, 
  FolderOpen, 
  Undo2, 
  Redo2, 
  Maximize2, 
  Key, 
  X,
  LayoutDashboard,
  FileText,
  Image as ImageIcon,
  Star,
  Plus,
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCcw,
  Check,
  CheckCircle2,
  Upload,
  HelpCircle,
  Download,
  Edit3,
  Camera,
  Layers,
  AlertCircle,
  ShieldCheck,
  Send,
  Languages,
  ArrowRight,
  Video
} from 'lucide-react';
import JSZip from 'jszip';

import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// --- Types ---
interface Character {
  id: string;
  name: string;
  description: string;
  images: string[]; // base64
  isDefault: boolean;
}

interface PromptVersion {
  id: string;
  prompt: string;
  image?: string;
  createdAt: number;
}

interface Scene {
  id: string;
  number: string; // "1", "C2", "3" etc.
  secondaryLanguage: string;
  vietnamese: string;
  promptName: string;
  backgroundPrompt: string;
  characterIds: string[];
  versions: PromptVersion[];
  mainVersionId: string | null;
  videoPrompt: string;
  videoSummary: string;
  isLoading: boolean;
  isImageLoading: boolean;
  isBackgroundLoading: boolean;
  isVideoLoading: boolean;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface AppState {
  projectName: string;
  activeTab: string;
  apiKey: string;
  characters: Character[];
  scenes: Scene[];
  globalStyle: string;
  globalVideoNotes: string;
}

// --- Utils ---
const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export default function App() {
  // --- States ---
  const [zoom, setZoom] = useState(1);
  const [projectName, setProjectName] = useState('DỰ ÁN MỚI');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [apiKey, setApiKey] = useState(localStorage.getItem('GEMINI_API_KEY') || '');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  
  // App Data
  const [characters, setCharacters] = useState<Character[]>([
    { id: '1', name: 'NHÂN VẬT 1', description: '', images: [], isDefault: true },
    { id: '2', name: 'NHÂN VẬT 2', description: '', images: [], isDefault: false },
    { id: '3', name: 'NHÂN VẬT 3', description: '', images: [], isDefault: false },
  ]);
  const [scenes, setScenes] = useState<Scene[]>([
    { 
      id: 's1', 
      number: '1', 
      secondaryLanguage: '', 
      vietnamese: '', 
      promptName: '', 
      backgroundPrompt: '', 
      characterIds: [], 
      versions: [],
      mainVersionId: null,
      videoPrompt: '',
      videoSummary: '',
      isLoading: false, 
      isImageLoading: false, 
      isBackgroundLoading: false,
      isVideoLoading: false
    }
  ]);
  const [globalStyle, setGlobalStyle] = useState('');
  const [flashingCell, setFlashingCell] = useState<{ id: string, type: 'image' | 'video' } | null>(null);

  useEffect(() => {
    if (flashingCell) {
      const timer = setTimeout(() => setFlashingCell(null), 500);
      return () => clearTimeout(timer);
    }
  }, [flashingCell]);

  const [globalVideoNotes, setGlobalVideoNotes] = useState('Không nhạc nền, không nhép miệng, chuyển động mượt mà');
  const [viewerVideoSceneId, setViewerVideoSceneId] = useState<string | null>(null);
  const [isStyleHelpOpen, setIsStyleHelpOpen] = useState(false);

  // Script Chat State
  const [isScriptChatOpen, setIsScriptChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [segmentationResult, setSegmentationResult] = useState('');
  const [selectedLanguageForImport, setSelectedLanguageForImport] = useState<'vi' | 'secondary' | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>(['English', 'Japanese', 'Korean', 'Chinese']);
  const [selectedSecondaryLang, setSelectedSecondaryLang] = useState('English');

  // Refinement states
  const [isRefining, setIsRefining] = useState(false);
  const [refinementInput, setRefinementInput] = useState('');
  const [refinementResult, setRefinementResult] = useState('');
  const [isTypingRefinement, setIsTypingRefinement] = useState(false);

  // Viewer State
  const [viewerSceneId, setViewerSceneId] = useState<string | null>(null);
  const [viewerVersionId, setViewerVersionId] = useState<string | null>(null);

  // Sync viewerVersionId when viewerSceneId changes
  useEffect(() => {
    if (viewerSceneId) {
      const scene = scenes.find(s => s.id === viewerSceneId);
      if (scene) {
        // Default to mainVersionId, or the first version if no main
        setViewerVersionId(scene.mainVersionId || (scene.versions.length > 0 ? scene.versions[0].id : null));
      }
    } else {
      setViewerVersionId(null);
    }
  }, [viewerSceneId, scenes]);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState<{ sceneId: string } | null>(null);

  // History Stack
  const [history, setHistory] = useState<{ past: AppState[]; present: AppState; future: AppState[] }>({
    past: [],
    present: { 
      projectName: 'DỰ ÁN MỚI', 
      activeTab: 'dashboard',
      apiKey: localStorage.getItem('GEMINI_API_KEY') || '',
      characters: [],
      scenes: [],
      globalStyle: ''
    },
    future: []
  });

  // --- History Handlers ---
  const addToHistory = useCallback((newState: AppState) => {
    setHistory(prev => ({
      past: [...prev.past, prev.present],
      present: newState,
      future: []
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, prev.past.length - 1);
      
      // Sync local states
      setProjectName(previous.projectName);
      setActiveTab(previous.activeTab);
      setApiKey(previous.apiKey);
      setCharacters(previous.characters);
      setScenes(previous.scenes);
      setGlobalStyle(previous.globalStyle);

      return {
        past: newPast,
        present: previous,
        future: [prev.present, ...prev.future]
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      const newFuture = prev.future.slice(1);

      // Sync local states
      setProjectName(next.projectName);
      setActiveTab(next.activeTab);
      setApiKey(next.apiKey);
      setCharacters(next.characters);
      setScenes(next.scenes);
      setGlobalStyle(next.globalStyle);

      return {
        past: [...prev.past, prev.present],
        present: next,
        future: newFuture
      };
    });
  }, []);

  // --- Sync History Present ---
  useEffect(() => {
    setHistory(prev => ({
      ...prev,
      present: {
        projectName,
        activeTab,
        apiKey,
        characters,
        scenes,
        globalStyle
      }
    }));
  }, [projectName, activeTab, apiKey, characters, scenes, globalStyle]);

  // --- File Handlers ---
  const handleSave = useCallback(() => {
    try {
      const dataToSave = {
        ...history.present,
        timestamp: new Date().toISOString()
      };
      
      const data = JSON.stringify(dataToSave, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `${slugify(projectName)}.json`;
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      
      toast.success(`Đã lưu dự án: ${filename}`);
    } catch (err) {
      toast.error('Lỗi khi lưu file!');
    }
  }, [history.present, projectName]);

  const handleOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (!data.projectName) throw new Error('File không hợp lệ');
          
          setProjectName(data.projectName);
          setActiveTab(data.activeTab || 'dashboard');
          setApiKey(data.apiKey || '');
          setCharacters(data.characters || []);
          setScenes(data.scenes || []);
          setGlobalStyle(data.globalStyle || '');
          
          addToHistory(data);
          toast.success('Đã mở dự án thành công!');
        } catch (err) {
          toast.error('File không hợp lệ hoặc bị lỗi!');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [addToHistory]);

  // --- AI Logic ---
  const generateBackgroundPrompt = async (sceneId: string) => {
    const sceneIndex = scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;
    const scene = scenes[sceneIndex];

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isBackgroundLoading: true } : s));

    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      // Get context from surrounding scenes
      const start = Math.max(0, sceneIndex - 3);
      const end = Math.min(scenes.length, sceneIndex + 4);
      const contextScenes = scenes.slice(start, end);
      
      const contextText = contextScenes.map(s => `Scene ${s.number}: ${s.vietnamese || s.promptName}`).join('\n');

      const prompt = `
        Bạn là một chuyên gia viết prompt bối cảnh cho AI tạo ảnh.
        Dựa trên kịch bản của Scene ${scene.number} và ngữ cảnh xung quanh, hãy viết một prompt bối cảnh chi tiết theo định dạng 6 PHẦN.
        
        NGỮ CẢNH:
        ${contextText}
        
        YÊU CẦU ĐỊNH DẠNG (TRẢ VỀ TIẾNG ANH):
        Phần 1: Tổng quan bối cảnh (Môi trường, ánh sáng, thời gian).
        Phần 2: Vị trí nhân vật trong không gian.
        Phần 3: Tư thế cụ thể của nhân vật.
        Phần 4: Biểu cảm khuôn mặt chi tiết.
        Phần 5: Vị trí và góc quay của Camera (Góc rộng, cận cảnh, từ trên xuống...).
        Phần 6: Điểm nhấn (Highlight) của khung hình (Hạt bụi, tia nắng, hiệu ứng...).
        
        LƯU Ý ĐỒNG NHẤT:
        - Nếu Scene này cùng địa điểm với các Scene trước đó, hãy giữ nguyên "Phần 1" nhưng thay đổi "Phần 3 & 5" để tránh đơn điệu.
        - Trả về văn bản thuần, không tiêu đề, không xuống dòng, các phần cách nhau bằng dấu phẩy hoặc chấm.
      `;

      const result = await ai.models.generateContent({ 
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }] 
      });
      const backgroundPrompt = result.text.trim();

      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, backgroundPrompt, isBackgroundLoading: false } : s));
      toast.success(`Đã tạo bối cảnh cho Scene ${scene.number}`);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tạo bối cảnh!');
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isBackgroundLoading: false } : s));
    }
  };

  const generatePromptFinal = async (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: true } : s));

    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      const selectedCharacters = characters.filter(c => scene.characterIds.includes(c.id));
      
      // 1. Cơ chế đọc dữ liệu từ Excel (Mapping variables)
      const var_STT = scene.number; // Cột A
      const var_KichBan = scene.vietnamese || scene.promptName; // Cột C
      const var_BoiCanh = scene.backgroundPrompt || ''; // Cột E
      const var_Style = globalStyle || 'Cinematic, high quality'; // Ô Quản lý phong cách

      // 2. Logic Phân tích Góc máy (Director Logic)
      const sceneIndex = scenes.findIndex(s => s.id === sceneId);
      const prevScenes = scenes.slice(Math.max(0, sceneIndex - 2), sceneIndex);
      const prevBackgrounds = prevScenes.map(s => s.backgroundPrompt || '').filter(Boolean);
      
      let cameraAngleCheck = "";
      if (prevBackgrounds.length > 0) {
        cameraAngleCheck = `
          QUY TẮC ĐẠO DIỄN (Góc máy): 
          Dưới đây là mô tả bối cảnh của 2 scene trước đó:
          ${prevBackgrounds.map((bg, i) => `Scene ${sceneIndex - prevBackgrounds.length + i + 1}: ${bg}`).join('\n')}
          
          Nếu góc máy trong var_BoiCanh hiện tại trùng với 2 hàng trước, hãy TỰ ĐỘNG thay đổi góc máy sang một góc khác (Close-up, Side view, Bird's eye, Low angle, v.v.) để đảm bảo tính đa dạng điện ảnh.
        `;
      }

      // 3. Dữ liệu nhân vật (Consistency Rule)
      const hasCharacter = var_STT.toLowerCase().includes('c') || selectedCharacters.length > 0;
      const characterDescription = selectedCharacters.map(c => `${c.name}: ${c.description}`).join(', ');

      const promptText = `
        Bạn là chuyên gia viết prompt cho AI tạo ảnh. Hãy tạo một Prompt Final duy nhất cho hàng này dựa trên dữ liệu sau.
        
        DỮ LIỆU ĐẦU VÀO:
        - var_KichBan (Cột C): ${var_KichBan}
        - var_BoiCanh (Cột E): ${var_BoiCanh}
        - var_Style: ${var_Style}
        - Nhân vật: ${hasCharacter ? characterDescription : "Không có nhân vật"}
        
        QUY TẮC NGẦM (HIDDEN INSTRUCTIONS - KHÔNG VIẾT VÀO KẾT QUẢ):
        1. Quy tắc Cách ly bối cảnh: Chỉ dùng ảnh nhân vật để lấy ngoại hình/trang phục. Tuyệt đối không vẽ lại bối cảnh trong ảnh nhân vật. Phải vẽ bối cảnh theo mô tả tại var_BoiCanh.
        2. Quy tắc Đồng nhất: Vì Scene có nhân vật, hãy sử dụng mô tả nhân vật dựa trên ảnh tham chiếu để đưa vào prompt.
        3. ${cameraAngleCheck}
        
        CÔNG THỨC GỘP (THE DYNAMIC LOGIC):
        Output = [Nội dung var_Style] + [Mô tả Nhân vật dựa trên ảnh tham chiếu] + [Nội dung var_BoiCanh đã được tối ưu góc máy].
        
        YÊU CẦU ĐỊNH DẠNG (BẮT BUỘC):
        - KHÔNG viết các câu lệnh như "YÊU CẦU QUAN TRỌNG...", "Phải tuân thủ đúng cú pháp...", hay "[CHARACTER_STYLE]" vào kết quả.
        - KHÔNG sử dụng nội dung mẫu về "mage in burgundy cloak" trừ khi dữ liệu thực sự mô tả như vậy.
        - KẾT QUẢ: Chỉ trả về một đoạn văn mô tả hình ảnh duy nhất bằng TIẾNG ANH, viết liền, không xuống dòng, không tiêu đề. 
        - Nội dung phải mô tả đúng những gì đang xảy ra ở var_KichBan và var_BoiCanh.
      `;

      // Prepare images for Gemini
      const parts: any[] = [{ text: promptText }];
      if (hasCharacter) {
        selectedCharacters.forEach(c => {
          c.images.slice(0, 1).forEach(img => {
            parts.push({
              inlineData: {
                data: img.split(',')[1],
                mimeType: "image/jpeg"
              }
            });
          });
        });
      }

      const result = await ai.models.generateContent({ 
        model: "gemini-3-flash-preview",
        contents: [{ parts }] 
      });
      
      const finalPrompt = result.text.trim().replace(/\n/g, ' ');
      const newVersionId = Math.random().toString(36).substr(2, 9);
      const newVersion: PromptVersion = {
        id: newVersionId,
        prompt: finalPrompt,
        createdAt: Date.now()
      };

      setScenes(prev => prev.map(s => s.id === sceneId ? { 
        ...s, 
        versions: [...s.versions, newVersion],
        mainVersionId: s.mainVersionId || newVersionId,
        isLoading: false 
      } : s));
      
      if (viewerSceneId === sceneId) {
        setViewerVersionId(newVersionId);
      }
      
      toast.success(`Đã tạo prompt cho Scene ${scene.number}`);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi gọi AI!');
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: false } : s));
    }
  };

  const refinePrompt = async (sceneId: string, type: 'character' | 'style' | 'angle' | 'ratio' | 'logic' | 'policy' | 'custom', customInput?: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;
    
    const version = scene.versions.find(v => v.id === viewerVersionId) || scene.versions.find(v => v.id === scene.mainVersionId);
    if (!version) return;

    setIsRefining(true);
    setRefinementResult('');
    setIsTypingRefinement(true);

    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      const typePrompts = {
        character: "Hãy xem lại ảnh gốc và mô tả nhân vật để sửa lại ngoại hình nhân vật trong prompt cho chính xác và đồng nhất hơn.",
        style: `Hãy đối chiếu với Style Prompt: "${globalStyle}" và đảm bảo phong cách vẽ hoàn toàn đồng nhất.`,
        angle: "Hãy quét các Scene trước/sau và chọn một góc máy hoàn toàn mới, độc đáo, mang tính điện ảnh cao.",
        ratio: "Sửa lại tỉ lệ và bố cục dựa trên logic của 3 scene gần nhất để đảm bảo tính liên kết thị giác.",
        logic: `Đọc lại kịch bản: "${scene.vietnamese || scene.promptName}" để hiểu sâu ngữ cảnh và sửa các lỗi logic trong prompt.`,
        policy: "Chuyển hướng mô tả sang dạng ẩn dụ, tập trung vào biểu cảm, ánh sáng và không khí để tránh các từ khóa nhạy cảm mà vẫn giữ được hồn của cảnh.",
        custom: customInput || ""
      };

      const promptText = `
        Bạn là chuyên gia tinh chỉnh prompt ảnh. 
        PROMPT HIỆN TẠI: "${version.prompt}"
        YÊU CẦU CỦA ĐẠO DIỄN: ${typePrompts[type]}
        
        Hãy viết lại prompt này bằng tiếng Anh để tối ưu hơn. 
        Giữ nguyên cấu trúc: [Style] + [Character] + [Background].
        Trả về văn bản thuần, không giải thích.
      `;

      const result = await ai.models.generateContent({ 
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: promptText }] }] 
      });
      
      const newPrompt = result.text.trim();
      
      // Typing effect
      let currentText = "";
      const words = newPrompt.split(' ');
      for (let i = 0; i < words.length; i++) {
        currentText += words[i] + ' ';
        setRefinementResult(currentText);
        await new Promise(r => setTimeout(r, 30));
      }

      setIsTypingRefinement(false);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tinh chỉnh!');
      setIsRefining(false);
      setIsTypingRefinement(false);
    }
  };

  const applyRefinement = (sceneId: string) => {
    const newVersionId = Math.random().toString(36).substr(2, 9);
    const newVersion: PromptVersion = {
      id: newVersionId,
      prompt: refinementResult,
      createdAt: Date.now()
    };
    
    setScenes(prev => prev.map(s => s.id === sceneId ? { 
      ...s, 
      versions: [...s.versions, newVersion],
      mainVersionId: newVersionId
    } : s));
    
    setViewerVersionId(newVersionId);
    setIsRefining(false);
    setRefinementResult('');
    toast.success('Đã tạo phiên bản prompt mới!');
  };

  const downloadSinglePrompt = (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;
    
    const version = scene.versions.find(v => v.id === scene.mainVersionId);
    if (!version) return;
    
    const blob = new Blob([version.prompt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene.number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Đã tải prompt Scene ${scene.number}`);
  };

  const downloadAllPrompts = async () => {
    const zip = new JSZip();
    let count = 0;
    
    scenes.forEach(scene => {
      const version = scene.versions.find(v => v.id === scene.mainVersionId);
      if (version) {
        zip.file(`${scene.number}.txt`, version.prompt);
        count++;
      }
    });

    if (count === 0) {
      toast.error('Chưa có prompt nào để tải!');
      return;
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TonghopPrompt_${projectName || 'Project'}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Đã tải ${count} prompt (.zip)`);
  };

  const generateVideoPrompt = async (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isVideoLoading: true } : s));

    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');
      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

      // Data A: Main version prompt
      const mainVersion = scene.versions.find(v => v.id === scene.mainVersionId);
      const dataA = mainVersion?.prompt || '';

      // Data B: Script content (current + 3-5 scenes before/after)
      const sceneIdx = scenes.findIndex(s => s.id === sceneId);
      const startIdx = Math.max(0, sceneIdx - 4);
      const endIdx = Math.min(scenes.length - 1, sceneIdx + 4);
      const dataB = scenes.slice(startIdx, endIdx + 1)
        .map(s => `Scene ${s.number}: ${s.vietnamese || s.promptName}`)
        .join('\n');

      // Data C: Background prompt
      const dataC = scene.backgroundPrompt || '';

      const prompt = `
        Bạn là chuyên gia viết prompt video cho model Veo-3.1. Hãy tạo một Video Prompt chuyên sâu dài trên 300 chữ, 100% Tiếng Anh, trình bày trong 1 đoạn duy nhất (không xuống dòng).
        
        DỮ LIỆU ĐẦU VÀO:
        - Prompt ảnh gốc (Start Frame): ${dataA}
        - Ngữ cảnh kịch bản (Story Flow): ${dataB}
        - Bối cảnh (Environment): ${dataC}
        - Lưu ý chung cho Video: ${globalVideoNotes}
        
        CẤU TRÚC PROMPT VIDEO (BẮT BUỘC):
        1. Start Frame: Mô tả góc máy khởi đầu dựa trên Prompt ảnh gốc.
        2. 8-Second Motion: Mô tả chi tiết chuyển động trong 8 giây. Phân rã thành các cảnh nhỏ (Segment 1, Segment 2...). Sử dụng thuật ngữ kỹ thuật Camera (Crane down, Dolly in, Pan, Tilt, Match cut, v.v.), hành động nhân vật, biểu cảm chi tiết và âm thanh môi trường.
        3. End Frame: Mô tả chi tiết khung hình kết thúc (vị trí nhân vật, trang phục, tỉ lệ cơ thể, tương quan với Camera).
        
        YÊU CẦU KHÁC:
        - Không được có tiêu đề hay số thứ tự trong kết quả trả về.
        - Chỉ trả về 1 đoạn văn bản duy nhất.
        - Cuối cùng, hãy thêm một dòng tóm tắt bằng Tiếng Việt (5-10 chữ) bắt đầu bằng "SUMMARY: ".
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }]
      });

      const fullText = result.text.trim();
      const summaryMatch = fullText.match(/SUMMARY:\s*(.*)$/i);
      const videoSummary = summaryMatch ? summaryMatch[1].trim() : "Chuyển động điện ảnh 8 giây";
      const videoPrompt = fullText.replace(/SUMMARY:\s*.*$/i, '').trim();

      setScenes(prev => prev.map(s => s.id === sceneId ? { 
        ...s, 
        videoPrompt, 
        videoSummary, 
        isVideoLoading: false 
      } : s));

      toast.success(`Đã tạo Video Prompt cho Scene ${scene.number}`);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tạo Video Prompt!');
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isVideoLoading: false } : s));
    }
  };

  const generateAllVideoPrompts = async () => {
    toast.info('Bắt đầu tạo Video Prompt hàng loạt...');
    for (const scene of scenes) {
      const mainVersion = scene.versions.find(v => v.id === scene.mainVersionId);
      if (mainVersion) {
        await generateVideoPrompt(scene.id);
      }
    }
  };

  const copyAllMainPrompts = () => {
    const allPrompts = scenes
      .map(s => {
        const version = s.versions.find(v => v.id === s.mainVersionId);
        return version ? `SCENE ${s.number}:\n${version.prompt}` : null;
      })
      .filter(Boolean)
      .join('\n\n');
      
    if (allPrompts) {
      navigator.clipboard.writeText(allPrompts);
      toast.success('Đã copy tất cả prompt chính!');
    } else {
      toast.error('Chưa có prompt chính nào!');
    }
  };

  const copyAllVideoPrompts = () => {
    const allPrompts = scenes
      .map(s => s.videoPrompt ? `SCENE ${s.number} (${s.videoSummary}):\n${s.videoPrompt}` : null)
      .filter(Boolean)
      .join('\n\n');
      
    if (allPrompts) {
      navigator.clipboard.writeText(allPrompts);
      toast.success('Đã copy tất cả video prompt!');
    } else {
      toast.error('Chưa có video prompt nào!');
    }
  };

  const generateImage = async (sceneId: string, versionId?: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;
    
    const targetVersionId = versionId || (viewerSceneId === sceneId ? viewerVersionId : null) || scene.mainVersionId;
    const version = scene.versions.find(v => v.id === targetVersionId);
    
    if (!version) {
      toast.error('Vui lòng tạo prompt trước!');
      return;
    }

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isImageLoading: true } : s));

    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: version.prompt,
            },
          ],
        },
      });

      let imageUrl = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString: string = part.inlineData.data;
          imageUrl = `data:image/png;base64,${base64EncodeString}`;
          break;
        }
      }

      if (!imageUrl) throw new Error('AI không trả về hình ảnh!');

      setScenes(prev => prev.map(s => s.id === sceneId ? { 
        ...s, 
        versions: s.versions.map(v => v.id === targetVersionId ? { ...v, image: imageUrl } : v),
        isImageLoading: false 
      } : s));
      toast.success(`Đã tạo ảnh cho Scene ${scene.number}`);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tạo ảnh!');
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isImageLoading: false } : s));
    }
  };

  const generateAllBackgrounds = async () => {
    toast.info('Bắt đầu tạo bối cảnh hàng loạt...');
    for (const scene of scenes) {
      if (scene.vietnamese || scene.promptName) {
        await generateBackgroundPrompt(scene.id);
      }
    }
    toast.success('Đã hoàn thành tạo bối cảnh hàng loạt!');
  };

  const generateAllPrompts = async () => {
    toast.info('Bắt đầu tạo prompt hàng loạt...');
    for (const scene of scenes) {
      if (scene.script) {
        await generatePromptFinal(scene.id);
      }
    }
  };

  const generateAllImages = async () => {
    toast.info('Bắt đầu tạo ảnh hàng loạt...');
    for (const scene of scenes) {
      const version = scene.versions.find(v => v.id === scene.mainVersionId);
      if (version) {
        await generateImage(scene.id, version.id);
      } else if (scene.versions.length > 0) {
        await generateImage(scene.id, scene.versions[0].id);
      }
    }
  };

  // --- Character Handlers ---
  const handleImageUpload = async (charId: string, files: FileList | null) => {
    if (!files) return;
    const char = characters.find(c => c.id === charId);
    if (!char) return;

    const newImages = [...char.images];
    for (let i = 0; i < files.length; i++) {
      if (newImages.length >= 5) break;
      const base64 = await fileToBase64(files[i]);
      newImages.push(base64);
    }

    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, images: newImages } : c));
    addToHistory({ ...history.present, characters: characters.map(c => c.id === charId ? { ...c, images: newImages } : c) });
  };

  const removeImage = (charId: string, index: number) => {
    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, images: c.images.filter((_, i) => i !== index) } : c));
  };

  const setDefaultCharacter = (charId: string) => {
    setCharacters(prev => prev.map(c => ({ ...c, isDefault: c.id === charId })));
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) throw new Error('File Excel trống!');

        const defaultChar = characters.find(c => c.isDefault);
        const newScenes: Scene[] = data.map((row, index) => {
          // Try to find columns by common names or indices
          const keys = Object.keys(row);
          const sceneNum = (row[keys[0]] || (index + 1)).toString();
          const secondary = row[keys[1]] || '';
          const vi = row[keys[2]] || '';
          const promptName = row[keys[3]] || '';
          const background = row[keys[4]] || '';
          
          const hasChar = sceneNum.toUpperCase().includes('C');
          const charIds = hasChar && defaultChar ? [defaultChar.id] : [];

          return {
            id: Math.random().toString(36).substr(2, 9),
            number: sceneNum,
            secondaryLanguage: secondary.toString(),
            vietnamese: vi.toString(),
            promptName: promptName.toString(),
            backgroundPrompt: background.toString(),
            characterIds: charIds,
            versions: [],
            mainVersionId: null,
            videoPrompt: '',
            videoSummary: '',
            isLoading: false,
            isImageLoading: false,
            isBackgroundLoading: false,
            isVideoLoading: false
          };
        });

        setScenes(newScenes);
        addToHistory({ ...history.present, scenes: newScenes });
        toast.success(`Đã nhập ${newScenes.length} phân cảnh từ Excel!`);
      } catch (err) {
        toast.error('Lỗi khi đọc file Excel!');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleRawScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let text = '';
      if (file.name.endsWith('.txt')) {
        text = await file.text();
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      }

      if (!text.trim()) throw new Error('File trống!');

      setChatMessages([
        { role: 'user', text: text },
        { role: 'model', text: 'Bạn cần hỗ trợ gì với kịch bản này?' }
      ]);
      setIsScriptChatOpen(true);
    } catch (err) {
      toast.error('Lỗi khi đọc file kịch bản!');
    }
  };

  const segmentScript = async () => {
    if (chatMessages.length === 0) return;
    const scriptContent = chatMessages[0].text;
    
    setIsSegmenting(true);
    setSegmentationResult('');
    
    try {
      const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!effectiveApiKey) throw new Error('Vui lòng cấu hình API Key!');
      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      const prompt = `Chia nhỏ kịch bản sau thành các dòng ngắn (7-15 chữ mỗi dòng), giữ nguyên ý nghĩa, xuống dòng cho mỗi đoạn. 
      Kịch bản:
      ${scriptContent}`;

      const result = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }]
      });

      let fullText = '';
      for await (const chunk of result) {
        const chunkText = chunk.text;
        fullText += chunkText;
        setSegmentationResult(fullText);
      }
      
      setChatMessages(prev => [...prev, { role: 'model', text: fullText }]);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi phân đoạn!');
    } finally {
      setIsSegmenting(false);
    }
  };

  const importSegmentedScript = (language: 'vi' | 'secondary') => {
    const lines = segmentationResult.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;

    const defaultChar = characters.find(c => c.isDefault);
    const newScenes: Scene[] = lines.map((line, index) => ({
      id: Math.random().toString(36).substr(2, 9),
      number: (index + 1).toString(),
      secondaryLanguage: language === 'secondary' ? line.trim() : '',
      vietnamese: language === 'vi' ? line.trim() : '',
      promptName: line.trim().substring(0, 50) + (line.length > 50 ? '...' : ''),
      backgroundPrompt: '',
      characterIds: [],
      versions: [],
      mainVersionId: null,
      videoPrompt: '',
      videoSummary: '',
      isLoading: false,
      isImageLoading: false,
      isBackgroundLoading: false,
      isVideoLoading: false
    }));

    setScenes(newScenes);
    addToHistory({ ...history.present, scenes: newScenes });
    setIsScriptChatOpen(false);
    toast.success(`Đã nhập ${newScenes.length} phân cảnh vào cột ${language === 'vi' ? 'Tiếng Việt' : 'Ngôn ngữ phụ'}!`);
  };

  const handleBackgroundFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let text = '';
      if (file.name.endsWith('.txt')) {
        text = await file.text();
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      }

      const lines = text.split('\n').filter(l => l.trim() !== '');
      setScenes(prev => prev.map((s, i) => i < lines.length ? { ...s, backgroundPrompt: lines[i].trim() } : s));
      toast.success('Đã nhập bối cảnh từ file thành công!');
    } catch (err) {
      toast.error('Lỗi khi đọc file bối cảnh!');
    }
  };

  // --- Scene Handlers ---
  const addScene = () => {
    const defaultChar = characters.find(c => c.isDefault);
    const newScene: Scene = {
      id: Math.random().toString(36).substr(2, 9),
      number: (scenes.length + 1).toString(),
      secondaryLanguage: '',
      vietnamese: '',
      promptName: '',
      backgroundPrompt: '',
      characterIds: defaultChar ? [defaultChar.id] : [],
      versions: [],
      mainVersionId: null,
      videoPrompt: '',
      videoSummary: '',
      isLoading: false,
      isImageLoading: false,
      isBackgroundLoading: false,
      isVideoLoading: false
    };
    setScenes(prev => [...prev, newScene]);
  };

  const removeScene = (id: string) => {
    if (scenes.length === 1) return;
    setScenes(prev => {
      const filtered = prev.filter(s => s.id !== id);
      return filtered.map((s, i) => {
        // Only re-index if it's a pure number
        if (!isNaN(Number(s.number))) {
          return { ...s, number: (i + 1).toString() };
        }
        return s;
      });
    });
  };

  const updateScene = (id: string, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const updatePromptVersion = (sceneId: string, versionId: string, newPrompt: string) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? {
      ...s,
      versions: s.versions.map(v => v.id === versionId ? { ...v, prompt: newPrompt } : v)
    } : s));
  };

  // --- Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        if (e.key === 's') { e.preventDefault(); handleSave(); }
        if (e.key === 'o') { e.preventDefault(); handleOpen(); }
        if (e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleOpen, undo, redo]);

  // --- Zoom Logic ---
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(prev => Math.min(Math.max(prev + delta, 0.5), 3));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('GEMINI_API_KEY', key);
    setIsApiKeyModalOpen(false);
    toast.success('Đã cập nhật API Key!');
  };

  return (
    <div className="relative min-h-screen w-full overflow-y-auto overflow-x-hidden selection:bg-green-100 selection:text-green-800">
      <Toaster position="top-right" expand={false} richColors />
      <div className="glow-bg" />

      {/* Floating UI (Not affected by zoom) */}
      <div className="fixed top-24 right-6 z-50 flex flex-col gap-3">
        <button 
          onClick={() => setZoom(1)} 
          className="w-12 h-12 rounded-full bg-white shadow-xl border border-green-100 flex items-center justify-center text-green-600 hover:scale-110 transition-all group"
          title="Reset Zoom 100%"
        >
          <Maximize2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
          <span className="absolute right-14 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">RESET 100%</span>
        </button>
      </div>

      <div className="fixed bottom-6 right-6 z-50">
        <button className="w-14 h-14 rounded-full bg-linear-to-br from-pink-500 to-rose-400 shadow-xl shadow-rose-200 flex items-center justify-center text-white hover:scale-110 transition-all group relative">
          <Heart className="w-6 h-6 fill-white group-hover:animate-ping absolute" />
          <Heart className="w-6 h-6 fill-white" />
          <div className="absolute -top-12 right-0 bg-white px-3 py-1.5 rounded-2xl shadow-lg border border-rose-100 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 pointer-events-none">
            <span className="text-[10px] font-bold text-rose-500 whitespace-nowrap">CHÚC NGÀY MỚI TỐT LÀNH! ❤️</span>
          </div>
        </button>
      </div>

      {/* Header */}
      <header className="frosted-header px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-green-500 to-green-300 flex items-center justify-center shadow-lg shadow-green-200">
            <LayoutDashboard className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold gradient-text tracking-tight">ZENITH GREEN</h1>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(1)} className="px-3 py-1.5 rounded-lg text-sm font-medium text-green-700 hover:bg-green-50 transition-colors border border-green-100 flex items-center gap-2">
            <Maximize2 className="w-4 h-4" /> Reset 100%
          </button>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <button onClick={undo} disabled={history.past.length === 0} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-all">
            <Undo2 className="w-5 h-5 text-slate-600" />
          </button>
          <button onClick={redo} disabled={history.future.length === 0} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-all">
            <Redo2 className="w-5 h-5 text-slate-600" />
          </button>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <button onClick={() => setIsApiKeyModalOpen(true)} className="px-3 py-1.5 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 transition-all flex items-center gap-2">
            <Settings className="w-4 h-4" /> ⚙️ API Config
          </button>
        </div>
      </header>

      {/* Main Content Wrapper (Zoomable) */}
      <div className="w-full h-full overflow-visible">
        <main 
          className="transition-transform duration-200 ease-out origin-top pb-32" 
          style={{ 
            transform: `scale(${zoom})`,
            width: `${100 / zoom}%`,
            marginLeft: `${(1 - 1/zoom) * 50}%`
          }}
        >
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col items-center gap-12">
          
          {/* Project Name Input */}
          <div className="relative group w-full max-w-2xl text-center">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value.toUpperCase())}
              onBlur={() => addToHistory({ ...history.present, projectName })}
              placeholder="NHẬP TÊN DỰ ÁN"
              className="w-full bg-transparent text-5xl md:text-7xl font-black text-center outline-none gradient-text placeholder:text-green-100 uppercase transition-all"
            />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 bg-linear-to-r from-green-400 to-green-200 rounded-full opacity-50 group-focus-within:w-full transition-all duration-500" />
          </div>

          {/* Tabs Navigation */}
          <div className="flex bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50 backdrop-blur-sm">
            {[
              { id: 'dashboard', label: 'Nhân vật', icon: LayoutDashboard },
              { id: 'editor', label: 'Bảng kịch bản', icon: FileText },
              { id: 'assets', label: 'Tài nguyên', icon: ImageIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === tab.id ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                }`}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Contents */}
          <div className="w-full min-h-[400px]">
            {/* --- Character Tab --- */}
            <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {characters.map((char) => (
                  <div key={char.id} className={`character-card ${char.isDefault ? 'is-default' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <input 
                        type="text"
                        value={char.name}
                        onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, name: e.target.value.toUpperCase() } : c))}
                        className="bg-transparent font-black text-lg outline-none gradient-text w-full"
                      />
                      <button 
                        onClick={() => setDefaultCharacter(char.id)}
                        className={`p-2 rounded-lg transition-all ${char.isDefault ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-400'}`}
                      >
                        <Star className={`w-5 h-5 ${char.isDefault ? 'fill-yellow-500' : ''}`} />
                      </button>
                    </div>

                    {/* Image Upload Area */}
                    <div 
                      className="aspect-video rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 mb-4 hover:border-green-300 hover:bg-green-50 transition-all cursor-pointer relative overflow-hidden group"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleImageUpload(char.id, e.dataTransfer.files); }}
                      onClick={() => document.getElementById(`file-${char.id}`)?.click()}
                    >
                      <input 
                        type="file" 
                        id={`file-${char.id}`} 
                        className="hidden" 
                        multiple 
                        accept="image/*" 
                        onChange={(e) => handleImageUpload(char.id, e.target.files)} 
                      />
                      <Upload className="w-6 h-6 text-slate-400 group-hover:text-green-500" />
                      <span className="text-xs font-bold text-slate-400 group-hover:text-green-600">KÉO THẢ HOẶC CLICK (1-5 ẢNH)</span>
                    </div>

                    {/* Image Previews */}
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                      {char.images.map((img, idx) => (
                        <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 group">
                          <img src={img} className="w-full h-full object-cover" />
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeImage(char.id, idx); }}
                            className="absolute inset-0 bg-red-500/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                          >
                            <Trash2 className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <textarea 
                      value={char.description}
                      onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, description: e.target.value } : c))}
                      placeholder="Mô tả đặc điểm đồng nhất (nốt ruồi, trang phục...)"
                      className="w-full h-24 p-3 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-sm resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* --- Editor Tab (Script Table) --- */}
            <div style={{ display: activeTab === 'editor' ? 'block' : 'none' }}>
              
              {/* Style Manager Section */}
              <div className="mb-8 p-6 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Quản lý Phong cách (Style Manager)</h3>
                    <button 
                      onClick={() => setIsStyleHelpOpen(true)}
                      className="p-1 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                    </button>
                  </div>
                    <div className="flex gap-2">
                      <button onClick={downloadAllPrompts} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <Download className="w-3 h-3" /> Tải toàn bộ (.zip)
                      </button>
                      <button onClick={copyAllMainPrompts} className="px-4 py-2 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <Copy className="w-3 h-3" /> Copy All (Main)
                      </button>
                      <button onClick={generateAllBackgrounds} className="px-4 py-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <RefreshCcw className="w-3 h-3" /> Bối cảnh hàng loạt
                      </button>
                      <button onClick={generateAllPrompts} className="px-4 py-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <Sparkles className="w-3 h-3" /> Prompt hàng loạt
                      </button>
                      <button onClick={generateAllImages} className="px-4 py-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <ImageIcon className="w-3 h-3" /> Ảnh hàng loạt
                      </button>
                      <button onClick={generateAllVideoPrompts} className="px-4 py-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white font-bold text-xs flex items-center gap-2 transition-all">
                        <Video className="w-3 h-3" /> Video Prompt hàng loạt
                      </button>
                    </div>
                </div>
                <textarea 
                  value={globalStyle}
                  onChange={(e) => setGlobalStyle(e.target.value)}
                  placeholder="Mô tả phong cách nghệ thuật chung cho toàn bộ dự án (Ví dụ: Studio Ghibli style, soft lighting, vibrant colors...)"
                  className="w-full h-24 p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-sm resize-none"
                />
              </div>

              <div className="flex justify-between items-center mb-6">
                <div className="flex gap-4">
                  <button onClick={addScene} className="px-6 py-2.5 rounded-xl btn-gradient font-bold text-sm flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Thêm Scene
                  </button>
                  <label className="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm">
                    <FolderOpen className="w-4 h-4" /> Upload Kịch bản Excel
                    <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelUpload} />
                  </label>
                  <label className="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm">
                    <FileText className="w-4 h-4" /> Upload Doc/Notepad
                    <input type="file" className="hidden" accept=".txt,.docx" onChange={handleRawScriptUpload} />
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="script-table w-full">
                  <thead>
                    <tr>
                      <th className="w-24 text-center">
                        <div className="flex items-center justify-center gap-1">
                          Scene
                          <button className="p-1 rounded-full hover:bg-slate-100 text-slate-400" title="Quy tắc: 1, C2, 3... 'C' là có nhân vật. File ảnh sẽ được đặt tên theo STT này.">
                            <HelpCircle className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                      <th className="w-40">
                        <select 
                          value={selectedSecondaryLang}
                          onChange={(e) => setSelectedSecondaryLang(e.target.value)}
                          className="bg-transparent outline-none font-bold text-slate-400 uppercase tracking-widest text-xs"
                        >
                          {availableLanguages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                        </select>
                      </th>
                      <th className="w-40">Tiếng Việt</th>
                      <th className="w-40">Tên Prompt</th>
                      <th className="w-1/4">Mô tả bối cảnh</th>
                      <th className="w-48">Nhân vật</th>
                      <th className="w-64">
                        <div className="flex items-center justify-between">
                          Prompt Final
                          <button 
                            onClick={copyAllMainPrompts}
                            className="p-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white transition-all"
                            title="Copy All Image Prompts"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                      <th className="w-64">
                        <div className="flex items-center justify-between">
                          Prompt Video
                          <button 
                            onClick={copyAllVideoPrompts}
                            className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition-all"
                            title="Copy All Video Prompts"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                      <th className="w-32">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.map((scene) => (
                      <tr key={scene.id} className="group">
                        <td className="text-center align-middle">
                          <input 
                            type="text"
                            value={scene.number}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateScene(scene.id, { 
                                number: val,
                                characterIds: val.toUpperCase().includes('C') && characters.find(c => c.isDefault) ? [characters.find(c => c.isDefault)!.id] : scene.characterIds
                              });
                            }}
                            className="w-full bg-transparent text-center font-black text-slate-400 outline-none focus:text-green-600"
                          />
                        </td>
                        <td className="align-middle">
                          <textarea 
                            value={scene.secondaryLanguage}
                            onChange={(e) => updateScene(scene.id, { secondaryLanguage: e.target.value })}
                            className="w-full h-20 p-2 bg-transparent outline-none text-xs resize-none"
                            placeholder="..."
                          />
                        </td>
                        <td className="align-middle">
                          <textarea 
                            value={scene.vietnamese}
                            onChange={(e) => updateScene(scene.id, { vietnamese: e.target.value })}
                            className="w-full h-20 p-2 bg-transparent outline-none text-xs resize-none"
                            placeholder="..."
                          />
                        </td>
                        <td className="align-middle">
                          <textarea 
                            value={scene.promptName}
                            onChange={(e) => updateScene(scene.id, { promptName: e.target.value })}
                            className="w-full h-20 p-2 bg-transparent outline-none text-xs resize-none font-medium"
                            placeholder="Tóm tắt..."
                          />
                        </td>
                        <td className="align-middle">
                          <div className="flex flex-col gap-2">
                            <textarea 
                              value={scene.backgroundPrompt}
                              onChange={(e) => updateScene(scene.id, { backgroundPrompt: e.target.value })}
                              className="w-full h-24 p-2 bg-slate-50/50 rounded-xl outline-none text-[10px] resize-none border border-transparent focus:border-green-200"
                              placeholder="Mô tả bối cảnh..."
                            />
                            <button 
                              onClick={() => generateBackgroundPrompt(scene.id)}
                              className="flex items-center gap-1 text-[10px] font-bold text-green-600 hover:text-green-700 transition-colors"
                            >
                              <RefreshCcw className={`w-3 h-3 ${scene.isBackgroundLoading ? 'animate-spin' : ''}`} />
                              VIẾT BỐI CẢNH (AI)
                            </button>
                          </div>
                        </td>
                        <td className="align-middle">
                          <div className="flex flex-col gap-2">
                            <div 
                              onClick={() => setIsCharacterModalOpen({ sceneId: scene.id })}
                              className="flex -space-x-2 cursor-pointer hover:scale-105 transition-transform p-2 bg-slate-50 rounded-xl border border-slate-100 min-h-[44px] items-center justify-center"
                            >
                              {scene.characterIds.length > 0 ? (
                                scene.characterIds.map(id => {
                                  const char = characters.find(c => c.id === id);
                                  return (
                                    <div key={id} className="w-8 h-8 rounded-full border-2 border-white bg-green-100 flex items-center justify-center overflow-hidden shadow-sm">
                                      {char?.images[0] ? <img src={char.images[0]} className="w-full h-full object-cover" /> : <span className="text-[10px] font-bold text-green-600">{char?.name[0]}</span>}
                                    </div>
                                  );
                                })
                              ) : (
                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">None</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="align-middle">
                          {scene.mainVersionId ? (
                            <div 
                              onClick={() => {
                                const prompt = scene.versions.find(v => v.id === scene.mainVersionId)?.prompt;
                                if (prompt) {
                                  navigator.clipboard.writeText(prompt);
                                  toast.success('Đã copy Prompt!');
                                  setFlashingCell({ id: scene.id, type: 'image' });
                                }
                              }}
                              onDoubleClick={() => setViewerSceneId(scene.id)}
                              title="Click để Copy - Double Click để Sửa"
                              className={`relative group/prompt cursor-pointer transition-all duration-300 rounded-xl overflow-hidden ${flashingCell?.id === scene.id && flashingCell?.type === 'image' ? 'flash-copy' : ''}`}
                            >
                              <div className="w-full h-24 p-2 bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-[10px] text-slate-500 leading-relaxed">
                                {scene.versions.find(v => v.id === scene.mainVersionId)?.prompt}
                              </div>
                              <div className="absolute top-1 right-1 flex gap-1">
                                <span className="px-1.5 py-0.5 rounded-md bg-green-500 text-white text-[8px] font-black uppercase shadow-sm">
                                  v{scene.versions.length}
                                </span>
                                {scene.versions.find(v => v.id === scene.mainVersionId)?.image && (
                                  <div className="w-4 h-4 rounded bg-blue-500 flex items-center justify-center shadow-sm">
                                    <ImageIcon className="w-2.5 h-2.5 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover/prompt:bg-black/5 transition-colors flex items-center justify-center">
                                <Maximize2 className="w-4 h-4 text-slate-600 opacity-0 group-hover/prompt:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-24 flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                              Chưa có prompt
                            </div>
                          )}
                        </td>
                        <td className="align-middle">
                          {scene.videoPrompt ? (
                            <div 
                              onClick={() => {
                                navigator.clipboard.writeText(scene.videoPrompt);
                                toast.success('Đã copy Prompt!');
                                setFlashingCell({ id: scene.id, type: 'video' });
                              }}
                              onDoubleClick={() => setViewerVideoSceneId(scene.id)}
                              title="Click để Copy - Double Click để Sửa"
                              className={`relative group/prompt cursor-pointer transition-all duration-300 rounded-xl overflow-hidden ${flashingCell?.id === scene.id && flashingCell?.type === 'video' ? 'flash-copy' : ''}`}
                            >
                              <div className="w-full h-24 p-2 bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-[10px] text-slate-500 leading-relaxed">
                                <div className="font-black text-green-600 mb-1 uppercase tracking-widest text-[8px]">{scene.videoSummary}</div>
                                <div className="line-clamp-3">{scene.videoPrompt}</div>
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover/prompt:bg-black/5 transition-colors flex items-center justify-center">
                                <Maximize2 className="w-4 h-4 text-slate-600 opacity-0 group-hover/prompt:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-24 flex items-center justify-center border border-dashed border-slate-200 rounded-xl text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                              Chưa có video prompt
                            </div>
                          )}
                        </td>
                        <td className="align-middle">
                          <div className="flex flex-col gap-1">
                            <button 
                              onClick={() => generatePromptFinal(scene.id)}
                              className={`p-2 rounded-lg transition-all flex items-center justify-center gap-2 text-[10px] font-bold shadow-sm ${scene.isLoading ? 'bg-green-100 text-green-600' : 'btn-gradient text-white hover:scale-105'}`}
                            >
                              {scene.isLoading ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              PROMPT
                            </button>
                            <button 
                              onClick={() => generateVideoPrompt(scene.id)}
                              className={`p-2 rounded-lg transition-all flex items-center justify-center gap-2 text-[10px] font-bold shadow-sm ${scene.isVideoLoading ? 'bg-green-100 text-green-600' : 'bg-green-50 text-green-600 hover:bg-green-500 hover:text-white'}`}
                            >
                              {scene.isVideoLoading ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
                              VIDEO
                            </button>
                            <button 
                              onClick={() => generateImage(scene.id)}
                              className={`p-2 rounded-lg transition-all flex items-center justify-center gap-2 text-[10px] font-bold shadow-sm ${scene.isImageLoading ? 'bg-green-100 text-green-600' : 'bg-green-50 text-green-600 hover:bg-green-500 hover:text-white'}`}
                            >
                              {scene.isImageLoading ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                              ẢNH
                            </button>
                            <div className="flex gap-1">
                              <button 
                                onClick={() => downloadSinglePrompt(scene.id)}
                                className="flex-1 p-2 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-500 hover:text-white transition-all flex items-center justify-center"
                                title="Tải Prompt (.txt)"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={() => setViewerSceneId(scene.id)}
                                className="flex-1 p-2 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-500 hover:text-white transition-all flex items-center justify-center"
                                title="Xem chi tiết & Sửa"
                              >
                                <Maximize2 className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={() => removeScene(scene.id)}
                                className="flex-1 p-2 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center"
                                title="Xóa"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Global Video Notes */}
              <div className="mt-12 w-full max-w-4xl mx-auto p-8 rounded-[32px] bg-white border border-slate-100 shadow-xl shadow-slate-200/50">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-green-500">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Lưu ý chung cho Video</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Global Video Motion Notes</p>
                  </div>
                </div>
                <textarea 
                  value={globalVideoNotes}
                  onChange={(e) => setGlobalVideoNotes(e.target.value)}
                  placeholder="Ví dụ: Không nhạc nền, không nhép miệng, chuyển động mượt mà, ánh sáng điện ảnh..."
                  className="w-full h-32 p-6 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-sm resize-none transition-all font-medium text-slate-600"
                />
              </div>
            </div>

            {/* --- Assets Tab --- */}
            <div style={{ display: activeTab === 'assets' ? 'block' : 'none' }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {scenes.filter(s => s.generatedImage).map(s => (
                  <div key={s.id} className="aspect-square rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 group relative">
                    <img src={s.generatedImage} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <button className="p-3 rounded-full bg-white text-slate-900 hover:scale-110 transition-transform">
                        <Maximize2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="aspect-square rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2">
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                  <span className="text-xs font-bold text-slate-400">ẢNH ĐÃ TẠO SẼ HIỆN Ở ĐÂY</span>
                </div>
              </div>
            </div>
          </div>

          <footer className="mt-20 text-center">
            <p className="text-slate-400 font-medium tracking-widest text-sm uppercase">Chucngaymoitotlanh</p>
          </footer>
        </div>
      </main>
      </div>

      {/* --- Viewer Modal --- */}
      <AnimatePresence>
        {viewerSceneId && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewerSceneId(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-6xl bg-white/90 backdrop-blur-2xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[85vh] border border-white/20"
            >
              {/* Left: Image/Preview Area */}
              <div className="flex-1 bg-slate-100/50 flex items-center justify-center relative group overflow-hidden">
                {(() => {
                  const scene = scenes.find(s => s.id === viewerSceneId);
                  const version = scene?.versions.find(v => v.id === viewerVersionId);
                  
                  if (version?.image) {
                    return <img src={version.image} className="w-full h-full object-contain" />;
                  } else if (scene?.isImageLoading) {
                    return (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 rounded-full border-4 border-green-200 border-t-green-500 animate-spin" />
                        <p className="text-green-600 font-bold uppercase tracking-widest text-xs">Đang tạo ảnh...</p>
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-center p-12">
                        <ImageIcon className="w-20 h-20 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Chưa có ảnh cho phiên bản này</p>
                      </div>
                    );
                  }
                })()}
                
                {/* Navigation */}
                <button 
                  onClick={() => {
                    const idx = scenes.findIndex(s => s.id === viewerSceneId);
                    if (idx > 0) setViewerSceneId(scenes[idx-1].id);
                  }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/20 backdrop-blur-md text-white hover:bg-white hover:text-slate-900 transition-all z-10 shadow-lg"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button 
                  onClick={() => {
                    const idx = scenes.findIndex(s => s.id === viewerSceneId);
                    if (idx < scenes.length - 1) setViewerSceneId(scenes[idx+1].id);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/20 backdrop-blur-md text-white hover:bg-white hover:text-slate-900 transition-all z-10 shadow-lg"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>

                <div className="absolute top-6 left-6 flex gap-2 z-10">
                  <div className="px-4 py-2 rounded-full bg-black/40 backdrop-blur-md text-white font-black text-sm shadow-sm">
                    SCENE {scenes.find(s => s.id === viewerSceneId)?.number}
                  </div>
                </div>
              </div>

              {/* Right: Prompt Details & Refinement */}
              <div className="w-full md:w-[450px] bg-white/80 backdrop-blur-md border-l border-white/20 flex flex-col">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex flex-col">
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm">Chi tiết & Lịch sử</h3>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Version Control System</span>
                  </div>
                  <button onClick={() => setViewerSceneId(null)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Current Prompt */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Prompt Phiên bản</label>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black">
                          {scenes.find(s => s.id === viewerSceneId)?.versions.findIndex(v => v.id === viewerVersionId) !== -1 
                            ? `v${(scenes.find(s => s.id === viewerSceneId)?.versions.findIndex(v => v.id === viewerVersionId) || 0) + 1}`
                            : 'NEW'}
                        </span>
                        {viewerVersionId === scenes.find(s => s.id === viewerSceneId)?.mainVersionId && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-600 text-[8px] font-black uppercase">Main</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => {
                            const scene = scenes.find(s => s.id === viewerSceneId);
                            const version = scene?.versions.find(v => v.id === viewerVersionId);
                            if (version?.prompt) {
                              navigator.clipboard.writeText(version.prompt);
                              toast.success('Đã copy vào bộ nhớ đệm');
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
                          title="Copy Prompt"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {viewerVersionId !== scenes.find(s => s.id === viewerSceneId)?.mainVersionId && (
                          <button 
                            onClick={() => {
                              setScenes(prev => prev.map(s => s.id === viewerSceneId ? { ...s, mainVersionId: viewerVersionId } : s));
                              toast.success('Đã đặt phiên bản này làm chính!');
                            }}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-green-500 transition-colors"
                            title="Đặt làm chính"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea 
                      value={scenes.find(s => s.id === viewerSceneId)?.versions.find(v => v.id === viewerVersionId)?.prompt || ''}
                      onChange={(e) => updatePromptVersion(viewerSceneId!, viewerVersionId!, e.target.value)}
                      className="w-full h-40 p-4 rounded-2xl bg-slate-50 border border-slate-100 text-xs text-slate-600 leading-relaxed font-medium outline-none focus:border-green-300 resize-none custom-scrollbar"
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          const scene = scenes.find(s => s.id === viewerSceneId);
                          const version = scene?.versions.find(v => v.id === viewerVersionId);
                          if (version?.prompt) {
                            navigator.clipboard.writeText(version.prompt);
                            toast.success('Đã copy Prompt!');
                          }
                        }}
                        className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-[10px] flex items-center justify-center gap-2 hover:bg-slate-200 transition-all"
                      >
                        <Copy className="w-3 h-3" /> COPY PROMPT
                      </button>
                      <button 
                        onClick={() => {
                          toast.success('Đã lưu thay đổi!');
                          setViewerSceneId(null);
                        }}
                        className="flex-1 py-2 rounded-xl btn-gradient text-white font-bold text-[10px] shadow-sm"
                      >
                        LƯU THAY ĐỔI
                      </button>
                    </div>
                  </div>

                  {/* Version History List */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lịch sử phiên bản ({scenes.find(s => s.id === viewerSceneId)?.versions.length})</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                      {scenes.find(s => s.id === viewerSceneId)?.versions.map((v, i) => (
                        <button 
                          key={v.id}
                          onClick={() => setViewerVersionId(v.id)}
                          className={`flex-shrink-0 w-20 h-20 rounded-xl border-2 transition-all overflow-hidden relative ${viewerVersionId === v.id ? 'border-green-500 scale-105 shadow-md' : 'border-slate-100 hover:border-slate-300'}`}
                        >
                          {v.image ? (
                            <img src={v.image} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-slate-50 flex items-center justify-center">
                              <span className="text-[10px] font-black text-slate-300">v{i+1}</span>
                            </div>
                          )}
                          {v.id === scenes.find(s => s.id === viewerSceneId)?.mainVersionId && (
                            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 border border-white shadow-sm" />
                          )}
                        </button>
                      ))}
                      <button 
                        onClick={() => generatePromptFinal(viewerSceneId!)}
                        className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 hover:border-green-300 hover:bg-green-50 transition-all flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-green-600"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="text-[8px] font-black uppercase">Mới</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Fixes */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tinh chỉnh nhanh (Quick-fix)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => refinePrompt(viewerSceneId!, 'character')} className="p-2.5 rounded-xl border border-slate-100 hover:border-green-200 hover:bg-green-50 text-[10px] font-bold text-slate-600 flex items-center gap-2 transition-all">
                        <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Đồng nhất NV
                      </button>
                      <button onClick={() => refinePrompt(viewerSceneId!, 'style')} className="p-2.5 rounded-xl border border-slate-100 hover:border-green-200 hover:bg-green-50 text-[10px] font-bold text-slate-600 flex items-center gap-2 transition-all">
                        <Sparkles className="w-3.5 h-3.5 text-green-500" /> Sai phong cách
                      </button>
                      <button onClick={() => refinePrompt(viewerSceneId!, 'angle')} className="p-2.5 rounded-xl border border-slate-100 hover:border-green-200 hover:bg-green-50 text-[10px] font-bold text-slate-600 flex items-center gap-2 transition-all">
                        <Camera className="w-3.5 h-3.5 text-green-500" /> Đổi góc độ
                      </button>
                      <button onClick={() => refinePrompt(viewerSceneId!, 'ratio')} className="p-2.5 rounded-xl border border-slate-100 hover:border-green-200 hover:bg-green-50 text-[10px] font-bold text-slate-600 flex items-center gap-2 transition-all">
                        <Maximize2 className="w-3.5 h-3.5 text-green-500" /> Sai tỉ lệ
                      </button>
                    </div>
                  </div>

                  {/* Refinement Result Area */}
                  <AnimatePresence>
                    {isRefining && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="p-4 rounded-2xl bg-green-50 border border-green-100 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Kết quả tinh chỉnh</span>
                          {isTypingRefinement && <RefreshCcw className="w-3 h-3 text-green-500 animate-spin" />}
                        </div>
                        <div className="text-xs text-green-800 leading-relaxed font-medium min-h-[60px]">
                          {refinementResult}
                          {isTypingRefinement && <span className="inline-block w-1 h-4 bg-green-500 animate-pulse ml-1" />}
                        </div>
                        {!isTypingRefinement && refinementResult && (
                          <div className="flex gap-2 pt-2">
                            <button 
                              onClick={() => applyRefinement(viewerSceneId!)}
                              className="flex-1 py-2 rounded-lg bg-green-500 text-white font-bold text-[10px] hover:bg-green-600 transition-all"
                            >
                              ÁP DỤNG (TẠO v{scenes.find(s => s.id === viewerSceneId)?.versions.length + 1})
                            </button>
                            <button 
                              onClick={() => { setIsRefining(false); setRefinementResult(''); }}
                              className="px-4 py-2 rounded-lg bg-white text-slate-400 font-bold text-[10px] border border-slate-100 hover:bg-slate-50 transition-all"
                            >
                              HỦY
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Custom Refinement */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Yêu cầu sửa riêng</label>
                    <div className="relative">
                      <textarea 
                        value={refinementInput}
                        onChange={(e) => setRefinementInput(e.target.value)}
                        placeholder="Nhập yêu cầu sửa cụ thể (Ví dụ: Thêm mưa, đổi màu áo sang đỏ...)"
                        className="w-full h-20 p-3 pr-10 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-xs resize-none"
                      />
                      <button 
                        onClick={() => {
                          if (refinementInput.trim()) {
                            refinePrompt(viewerSceneId!, 'custom', refinementInput);
                            setRefinementInput('');
                          }
                        }}
                        className="absolute right-2 bottom-2 p-2 rounded-lg btn-gradient text-white shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex gap-3">
                  <button 
                    onClick={() => generateImage(viewerSceneId!, viewerVersionId || undefined)}
                    className={`flex-1 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${scenes.find(s => s.id === viewerSceneId)?.isImageLoading ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'btn-gradient text-white shadow-green-200'}`}
                    disabled={scenes.find(s => s.id === viewerSceneId)?.isImageLoading}
                  >
                    {scenes.find(s => s.id === viewerSceneId)?.isImageLoading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                    TẠO ẢNH (v{(scenes.find(s => s.id === viewerSceneId)?.versions.findIndex(v => v.id === viewerVersionId) || 0) + 1})
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Character Selection Modal --- */}
      <AnimatePresence>
        {isCharacterModalOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCharacterModalOpen(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
              <h3 className="text-xl font-bold text-slate-800 mb-6">Chọn nhân vật cho Scene</h3>
              <div className="space-y-3">
                {characters.map(char => {
                  const isSelected = scenes.find(s => s.id === isCharacterModalOpen.sceneId)?.characterIds.includes(char.id);
                  return (
                    <button 
                      key={char.id}
                      onClick={() => {
                        const scene = scenes.find(s => s.id === isCharacterModalOpen.sceneId);
                        if (!scene) return;
                        const newIds = isSelected ? scene.characterIds.filter(id => id !== char.id) : [...scene.characterIds, char.id];
                        updateScene(scene.id, { characterIds: newIds });
                      }}
                      className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between ${isSelected ? 'border-green-400 bg-green-50' : 'border-slate-100 hover:border-green-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden">
                          {char.images[0] && <img src={char.images[0]} className="w-full h-full object-cover" />}
                        </div>
                        <span className="font-bold text-slate-700">{char.name}</span>
                      </div>
                      {isSelected && <Check className="w-5 h-5 text-green-500" />}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setIsCharacterModalOpen(null)} className="w-full mt-6 py-3 rounded-xl btn-gradient font-bold">Xong</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fixed Elements */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col gap-4">
        <button className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-200 hover:scale-110 active:scale-95 transition-all group">
          <Heart className="text-white w-8 h-8 fill-white" />
        </button>
      </div>

      <div className="fixed bottom-8 left-8 z-[100] flex gap-2">
        <button onClick={handleSave} className="px-6 py-3 rounded-xl btn-gradient shadow-sm flex items-center gap-2 font-bold text-sm">
          <Save className="w-4 h-4" /> Lưu (Ctrl+S)
        </button>
        <button onClick={handleOpen} className="px-6 py-3 rounded-xl btn-gradient shadow-sm flex items-center gap-2 font-bold text-sm">
          <FolderOpen className="w-4 h-4" /> Mở (Ctrl+O)
        </button>
      </div>

      {/* API Key Modal */}
      <AnimatePresence>
        {isApiKeyModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsApiKeyModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md frosted-modal rounded-3xl p-8 overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-linear-to-r from-green-500 to-green-300" />
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800">Cấu hình API Key</h3>
                <button onClick={() => setIsApiKeyModalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <p className="text-slate-500 text-sm mb-6">Nhập Gemini API Key của bạn. <br/><span className="text-green-600 font-medium italic">Fallback: Nếu trống, hệ thống sẽ sử dụng Key mặc định.</span></p>
              <div className="space-y-4">
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input type="password" defaultValue={apiKey} placeholder="AIzaSy..." className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/50 border border-white/40 outline-none focus:border-green-300 transition-all" id="api-key-input" />
                </div>
                <button onClick={() => saveApiKey((document.getElementById('api-key-input') as HTMLInputElement).value)} className="w-full py-3 rounded-xl btn-gradient font-bold">Lưu thiết lập</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Style Help Modal */}
      <AnimatePresence>
        {isStyleHelpOpen && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsStyleHelpOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative w-full max-w-2xl bg-white rounded-[40px] p-10 shadow-2xl overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-linear-to-r from-green-500 to-green-300" />
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black gradient-text">HƯỚNG DẪN MÔ TẢ PHONG CÁCH</h3>
                <button onClick={() => setIsStyleHelpOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X className="w-6 h-6 text-slate-400" /></button>
              </div>
              
              <div className="space-y-6 text-slate-600">
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <h4 className="font-bold text-slate-800 mb-2">Cách mô tả hiệu quả:</h4>
                  <ul className="list-disc list-inside space-y-2 text-sm">
                    <li>Nêu rõ phong cách nghệ thuật (Anime, Realistic, Oil Painting...).</li>
                    <li>Mô tả ánh sáng (Soft lighting, Cinematic, Neon...).</li>
                    <li>Mô tả màu sắc chủ đạo (Vibrant, Pastel, Monochromatic...).</li>
                    <li>Nêu tên nghệ sĩ hoặc studio truyền cảm hứng (Ghibli, Pixar, Greg Rutkowski...).</li>
                  </ul>
                </div>

                <div className="p-6 rounded-3xl bg-green-50 border border-green-100">
                  <h4 className="font-bold text-green-800 mb-2">Công cụ phân tích phong cách đối thủ:</h4>
                  <p className="text-sm mb-4">Sử dụng lệnh này để AI phân tích chính xác phong cách từ hình ảnh mẫu của bạn.</p>
                  <button 
                    onClick={() => {
                      const competitorPrompt = "Dựa vào ảnh tôi gửi kèm Prompt này, hãy phân tích kỹ phong cách nghệ thuật, ánh sáng, màu sắc và cách vẽ nhân vật. Sau đó, hãy viết một đoạn mô tả phong cách (Style Prompt) cực kỳ chi tiết bằng tiếng Anh để tôi có thể tái tạo phong cách này trong các bức ảnh khác. Yêu cầu: Trả về văn bản thuần, không tiêu đề, không xuống dòng.";
                      navigator.clipboard.writeText(competitorPrompt);
                      toast.success('Đã copy Prompt Phân tích!');
                    }}
                    className="w-full py-4 rounded-2xl btn-gradient font-bold flex items-center justify-center gap-2"
                  >
                    <Copy className="w-5 h-5" /> Copy Prompt Phân tích
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Script Chat Modal */}
      <AnimatePresence>
        {isScriptChatOpen && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsScriptChatOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center text-white">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight">Xử lý kịch bản thô</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Script Assistant</p>
                  </div>
                </div>
                <button onClick={() => setIsScriptChatOpen(false)} className="p-2 rounded-xl hover:bg-slate-200 transition-colors">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-4 rounded-3xl text-sm shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-green-500 text-white rounded-tr-none' 
                        : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
                    }`}>
                      <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                    </div>
                  </div>
                ))}
                {isSegmenting && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] p-4 rounded-3xl bg-white text-slate-700 border border-slate-100 rounded-tl-none shadow-sm">
                      <div className="flex items-center gap-2 text-green-600 font-bold animate-pulse">
                        <RefreshCcw className="w-4 h-4 animate-spin" /> ĐANG PHÂN ĐOẠN...
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{segmentationResult}</pre>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex flex-col gap-4">
                <div className="flex gap-3">
                  <button 
                    onClick={segmentScript}
                    disabled={isSegmenting}
                    className="flex-1 py-3 rounded-2xl btn-gradient font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCcw className={`w-4 h-4 ${isSegmenting ? 'animate-spin' : ''}`} />
                    PHÂN ĐOẠN (AUTOMATION)
                  </button>
                  
                  {segmentationResult && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSelectedLanguageForImport('vi')}
                        className="px-6 py-3 rounded-2xl bg-slate-100 text-slate-600 hover:bg-green-50 hover:text-green-600 font-bold text-sm transition-all"
                      >
                        TRÌNH BÀY (TIẾNG VIỆT)
                      </button>
                      <button 
                        onClick={() => setSelectedLanguageForImport('secondary')}
                        className="px-6 py-3 rounded-2xl bg-slate-100 text-slate-600 hover:bg-green-50 hover:text-green-600 font-bold text-sm transition-all"
                      >
                        TRÌNH BÀY ({selectedSecondaryLang.toUpperCase()})
                      </button>
                    </div>
                  )}
                </div>

                {selectedLanguageForImport && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-bold text-green-800">
                        Xác nhận đổ dữ liệu vào cột {selectedLanguageForImport === 'vi' ? 'Tiếng Việt' : selectedSecondaryLang}?
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedLanguageForImport(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-600">HỦY</button>
                      <button 
                        onClick={() => importSegmentedScript(selectedLanguageForImport)}
                        className="px-6 py-2 rounded-xl bg-green-600 text-white font-bold text-xs shadow-lg shadow-green-200"
                      >
                        XÁC NHẬN
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Character Selection Modal */}
      <AnimatePresence>
        {isCharacterModalOpen && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCharacterModalOpen(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-lg bg-white rounded-[40px] shadow-2xl overflow-hidden p-8"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Gán nhân vật</h3>
                <button onClick={() => setIsCharacterModalOpen(null)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="space-y-3">
                {characters.map((char) => {
                  const isSelected = scenes.find(s => s.id === isCharacterModalOpen.sceneId)?.characterIds.includes(char.id);
                  return (
                    <button
                      key={char.id}
                      onClick={() => {
                        const scene = scenes.find(s => s.id === isCharacterModalOpen.sceneId);
                        if (!scene) return;
                        const newIds = isSelected 
                          ? scene.characterIds.filter(id => id !== char.id)
                          : [...scene.characterIds, char.id];
                        updateScene(scene.id, { characterIds: newIds });
                      }}
                      className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between group ${
                        isSelected ? 'border-green-500 bg-green-50' : 'border-slate-100 hover:border-green-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                          {char.images[0] ? <img src={char.images[0]} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-green-600 font-bold">{char.name[0]}</div>}
                        </div>
                        <div className="text-left">
                          <p className={`font-bold text-sm ${isSelected ? 'text-green-700' : 'text-slate-700'}`}>{char.name}</p>
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{char.isDefault ? 'Mặc định' : 'Phụ'}</p>
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 group-hover:border-green-300'
                      }`}>
                        {isSelected && <Check className="w-4 h-4" />}
                      </div>
                    </button>
                  );
                })}
                
                <button
                  onClick={() => {
                    const scene = scenes.find(s => s.id === isCharacterModalOpen.sceneId);
                    if (scene) updateScene(scene.id, { characterIds: [] });
                  }}
                  className="w-full p-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all font-bold text-xs uppercase tracking-widest"
                >
                  Bỏ gán tất cả (None)
                </button>
              </div>

              <button 
                onClick={() => setIsCharacterModalOpen(null)}
                className="w-full mt-8 py-4 rounded-2xl btn-gradient font-bold shadow-lg shadow-green-200"
              >
                HOÀN TẤT
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- Video Prompt Modal --- */}
      <AnimatePresence>
        {viewerVideoSceneId && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewerVideoSceneId(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" />
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="relative w-full max-w-4xl bg-white/90 backdrop-blur-2xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh] border border-white/20"
            >
              {/* Header */}
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-green-500 text-white flex items-center justify-center shadow-lg shadow-green-200">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Trình biên tập Video Prompt</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Scene {scenes.find(s => s.id === viewerVideoSceneId)?.number}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span className="text-xs text-green-600 font-black uppercase tracking-widest">{scenes.find(s => s.id === viewerVideoSceneId)?.videoSummary}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setViewerVideoSceneId(null)} className="p-3 rounded-2xl hover:bg-slate-100 transition-colors">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8">
                <div className="space-y-8">
                  {/* Video Prompt Editor */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Nội dung Prompt (Veo-3.1 Format)</label>
                      <button 
                        onClick={() => {
                          const scene = scenes.find(s => s.id === viewerVideoSceneId);
                          if (scene?.videoPrompt) {
                            navigator.clipboard.writeText(scene.videoPrompt);
                            toast.success('Đã copy vào bộ nhớ đệm');
                          }
                        }}
                        className="flex items-center gap-2 text-xs font-bold text-green-600 hover:text-green-700 transition-colors"
                      >
                        <Copy className="w-3 h-3" /> COPY TOÀN BỘ PROMPT
                      </button>
                    </div>
                    <textarea 
                      value={scenes.find(s => s.id === viewerVideoSceneId)?.videoPrompt || ''}
                      onChange={(e) => updateScene(viewerVideoSceneId!, { videoPrompt: e.target.value })}
                      className="w-full h-[400px] p-8 rounded-[32px] bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-base leading-relaxed text-slate-600 font-medium resize-none shadow-inner"
                      placeholder="Nội dung video prompt sẽ hiển thị ở đây..."
                    />
                  </div>

                  {/* Summary Editor */}
                  <div className="space-y-4">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Tóm tắt chuyển động (Vietnamese)</label>
                    <input 
                      type="text"
                      value={scenes.find(s => s.id === viewerVideoSceneId)?.videoSummary || ''}
                      onChange={(e) => updateScene(viewerVideoSceneId!, { videoSummary: e.target.value })}
                      className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-green-300 text-sm font-bold text-green-600 shadow-sm"
                      placeholder="Ví dụ: Camera xoay quanh nhân vật, ánh sáng mờ ảo..."
                    />
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => generateVideoPrompt(viewerVideoSceneId!)}
                    disabled={scenes.find(s => s.id === viewerVideoSceneId)?.isVideoLoading}
                    className="px-8 py-4 rounded-2xl btn-gradient text-white font-black text-sm flex items-center gap-3 hover:scale-105 transition-all shadow-xl shadow-green-200 disabled:opacity-50"
                  >
                    {scenes.find(s => s.id === viewerVideoSceneId)?.isVideoLoading ? (
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5" />
                    )}
                    TẠO LẠI PROMPT (REGENERATE)
                  </button>
                </div>
                <button 
                  onClick={() => setViewerVideoSceneId(null)}
                  className="px-8 py-4 rounded-2xl bg-slate-800 text-white font-black text-sm hover:bg-slate-900 transition-all shadow-xl shadow-slate-200"
                >
                  LƯU & ĐÓNG
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
