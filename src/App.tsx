import { useState, useEffect, ChangeEvent } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { MapPin, Route, Search, Trash2, Loader2, AlertCircle, ImagePlus, X, Save, Package, CheckCircle2, Navigation } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const apiKey = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;
try {
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  }
} catch (e) {
  console.error("Failed to initialize Gemini API:", e);
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [pickupAddress, setPickupAddress] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [autoClear, setAutoClear] = useState(true);
  const [draftData, setDraftData] = useState<{inputText: string, addresses: string[], pickupAddress?: string} | null>(null);

  // Check for saved draft on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem('roteirizador_draft');
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.inputText || (parsed.addresses && parsed.addresses.length > 0) || parsed.pickupAddress) {
          setDraftData(parsed);
          setShowDraftPrompt(true);
        }
      } catch (e) {
        console.error('Error parsing draft:', e);
      }
    }
  }, []);

  // Save draft when input or addresses change
  useEffect(() => {
    if (!showDraftPrompt) {
      if (inputText || addresses.length > 0 || pickupAddress) {
        localStorage.setItem('roteirizador_draft', JSON.stringify({ inputText, addresses, pickupAddress }));
      } else {
        localStorage.removeItem('roteirizador_draft');
      }
    }
  }, [inputText, addresses, pickupAddress, showDraftPrompt]);

  const restoreDraft = () => {
    if (draftData) {
      setInputText(draftData.inputText || '');
      setAddresses(draftData.addresses || []);
      setPickupAddress(draftData.pickupAddress || '');
    }
    setShowDraftPrompt(false);
    setDraftData(null);
  };

  const discardDraft = () => {
    localStorage.removeItem('roteirizador_draft');
    setShowDraftPrompt(false);
    setDraftData(null);
  };

  // Generate previews when images change
  useEffect(() => {
    const newPreviews = images.map(file => URL.createObjectURL(file));
    setImagePreviews(newPreviews);
    
    // Cleanup URLs to avoid memory leaks
    return () => {
      newPreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [images]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages(prev => [...prev, ...newFiles]);
    }
    // Reset input value so the same file can be selected again if needed
    e.target.value = '';
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setImages(images.filter((_, index) => index !== indexToRemove));
  };

  const handleRemoveAllImages = () => {
    setImages([]);
  };

  const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string, mimeType: string } }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string).split(',')[1];
        resolve({
          inlineData: {
            data: base64Data,
            mimeType: file.type
          }
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleExtract = async () => {
    if (!apiKey || !ai) {
      setError('Chave de API do Google Gemini não configurada. Configure a variável GEMINI_API_KEY na Vercel.');
      return;
    }

    if (!inputText.trim() && images.length === 0) {
      setError('Por favor, insira algum texto ou adicione fotos com endereços.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const imageParts = await Promise.all(images.map(fileToGenerativePart));
      
      // Limpa o texto removendo caracteres especiais indesejados e espaços extras
      // Mantém letras (incluindo acentos), números, espaços e pontuações comuns em endereços
      let cleanedText = inputText
        .replace(/[^\p{L}\p{N}\s.,\-/:;()ºª#]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
        
      // Normaliza abreviações comuns para ajudar a IA
      cleanedText = cleanedText
        .replace(/\bR\.\s*/gi, 'Rua ')
        .replace(/\bAv\.\s*/gi, 'Avenida ')
        .replace(/\bAl\.\s*/gi, 'Alameda ')
        .replace(/\bTv\.\s*/gi, 'Travessa ')
        .replace(/\bRod\.\s*/gi, 'Rodovia ')
        .replace(/\bEstr\.\s*/gi, 'Estrada ')
        .replace(/\bPr\.\s*/gi, 'Praça ')
        .replace(/Pça\.\s*/gi, 'Praça ')
        .replace(/\bVl\.\s*/gi, 'Vila ')
        .replace(/\bJd\.\s*/gi, 'Jardim ')
        .replace(/\bRes\.\s*/gi, 'Residencial ')
        .replace(/\bCond\.\s*/gi, 'Condomínio ')
        .replace(/\bApto\.\s*/gi, 'Apartamento ')
        .replace(/\bAp\.\s*/gi, 'Apartamento ')
        .replace(/\bBl\.\s*/gi, 'Bloco ')
        .replace(/\bCj\.\s*/gi, 'Conjunto ')
        .replace(/\bEd\.\s*/gi, 'Edifício ');

      // Normaliza formatos de CEP (ex: 12345678 -> 12345-678)
      cleanedText = cleanedText.replace(/\b(\d{5})[-.\s]?(\d{3})\b/g, '$1-$2');
      
      const textPart = {
        text: `Você é um especialista em logística e roteirização no Brasil.
Sua tarefa é:
1. Extrair todos os endereços completos mencionados no texto e/ou nas imagens fornecidas.
2. Formatar cada endereço de forma padronizada (ex: "Rua Nome, Número - Bairro, Cidade - Estado, CEP").
3. Ordenar esses endereços de forma lógica para criar a rota mais eficiente (menor percurso possível), assumindo que o primeiro endereço extraído ou o mais central seja o ponto de partida.
4. Retorne APENAS um array JSON contendo as strings dos endereços formatados e ordenados.

Texto:
${cleanedText || 'Nenhum texto fornecido. Extraia os endereços apenas das imagens.'}`
      };

      const response = await ai!.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [...imageParts, textPart] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              description: 'Um endereço completo extraído e ordenado para a melhor rota.',
            },
          },
        },
      });

      if (response.text) {
        let jsonText = response.text.trim();
        // Remove markdown formatting if present
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
        }
        
        try {
          const extractedAddresses = JSON.parse(jsonText);
          if (!Array.isArray(extractedAddresses) || extractedAddresses.length === 0) {
            setError('Nenhum endereço encontrado no texto ou nas imagens.');
          } else {
            setAddresses(extractedAddresses);
          }
        } catch (parseError) {
          console.error('Erro ao analisar JSON:', parseError, 'Texto recebido:', jsonText);
          setError('A inteligência artificial retornou um formato inválido. Tente novamente.');
        }
      } else {
        setError('Falha ao extrair endereços. Tente novamente.');
      }
    } catch (err) {
      console.error('Erro ao extrair endereços:', err);
      setError('Ocorreu um erro ao processar os dados. Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAddress = (indexToRemove: number) => {
    setAddresses(addresses.filter((_, index) => index !== indexToRemove));
  };

  const handleGetCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setError("Seu navegador não suporta geolocalização.");
      return;
    }

    setIsGettingLocation(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setPickupAddress(`${latitude},${longitude}`);
        setIsGettingLocation(false);
      },
      (err) => {
        console.warn("Geolocalização falhou ou foi negada:", err);
        setError("Não foi possível obter sua localização. Verifique as permissões do navegador.");
        setIsGettingLocation(false);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  const openFullRoute = () => {
    if (addresses.length === 0 && !pickupAddress) return;
    
    // Abre a janela de forma síncrona para evitar bloqueadores de pop-up
    const newWindow = window.open('', '_blank');
    if (!newWindow) {
      setError('O bloqueador de pop-ups impediu a abertura do mapa. Por favor, permita pop-ups para este site.');
      return;
    }
    
    newWindow.document.write('<div style="font-family: sans-serif; padding: 20px; text-align: center; color: #3f3f46;">Calculando a melhor rota e abrindo o Google Maps...</div>');

    const buildUrlAndRedirect = (startPoint?: string) => {
      const baseUrl = 'https://www.google.com/maps/dir/';
      
      const routeAddresses = [];
      if (startPoint) routeAddresses.push(startPoint);
      if (pickupAddress) routeAddresses.push(pickupAddress);
      routeAddresses.push(...addresses);

      const path = routeAddresses.map(addr => encodeURIComponent(addr)).join('/');
      newWindow.location.href = `${baseUrl}${path}`;

      if (autoClear) {
        setTimeout(() => {
          setInputText('');
          setImages([]);
          setAddresses([]);
          setPickupAddress('');
          setClearNotice("Campos limpos para uma nova rota.");
          setTimeout(() => setClearNotice(null), 5000);
        }, 1000);
      }
    };

    // Tenta usar a localização atual do usuário como ponto de partida
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const startPoint = `${latitude},${longitude}`;
          
          setLocationNotice("Sua localização atual foi usada como ponto de partida.");
          setTimeout(() => setLocationNotice(null), 6000);
          
          buildUrlAndRedirect(startPoint);
        },
        (err) => {
          console.warn("Geolocalização falhou ou foi negada:", err);
          buildUrlAndRedirect(); // Fallback: usa apenas os endereços extraídos
        },
        { timeout: 5000, maximumAge: 60000 }
      );
    } else {
      buildUrlAndRedirect();
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-red-200">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-red-600 p-2 rounded-lg text-white">
              <Route size={20} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 uppercase">
              RL ROTEIRIZADOR
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence>
          {showDraftPrompt && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3 text-red-800">
                <div className="bg-red-100 p-2 rounded-lg">
                  <Save size={20} className="text-red-600" />
                </div>
                <div>
                  <h3 className="font-medium">Rascunho encontrado</h3>
                  <p className="text-sm text-red-600/80">Você tem dados não salvos da sua última sessão.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={discardDraft}
                  className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 rounded-lg transition-colors"
                >
                  Descartar
                </button>
                <button
                  onClick={restoreDraft}
                  className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-sm"
                >
                  Continuar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column: Input */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-medium text-zinc-800">Dados de Entrada</h2>
                <label className="cursor-pointer flex items-center gap-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors">
                  <ImagePlus size={16} />
                  <span>Adicionar Fotos</span>
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload} 
                  />
                </label>
              </div>
              <p className="text-sm text-zinc-500 mb-4">
                Cole um texto ou adicione fotos (prints, recibos) com os endereços. A IA fará o resto.
              </p>
            </div>
            
            <div className="relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Exemplo: Entregar pacote na Rua das Flores, 123, Centro. Depois passar na Av. Paulista, 1000..."
                className="w-full h-48 p-4 bg-white border border-zinc-200 rounded-xl shadow-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none transition-shadow text-zinc-700"
              />
            </div>

            {imagePreviews.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{images.length} {images.length === 1 ? 'Foto adicionada' : 'Fotos adicionadas'}</span>
                  <button
                    onClick={handleRemoveAllImages}
                    className="text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Apagar todas
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {imagePreviews.map((preview, index) => (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      key={index} 
                      className="relative flex-shrink-0 w-20 h-20 rounded-lg border border-zinc-200 overflow-hidden group shadow-sm bg-white"
                    >
                      <img src={preview} alt={`Preview ${index}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleRemoveImage(index)}
                        className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        title="Remover foto"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm border border-red-100"
              >
                <AlertCircle size={16} />
                <span>{error}</span>
              </motion.div>
            )}

            <button
              onClick={handleExtract}
              disabled={isLoading || (!inputText.trim() && images.length === 0)}
              className="w-full flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white py-3 px-4 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Analisando e Extraindo...</span>
                </>
              ) : (
                <>
                  <Search size={18} />
                  <span>Extrair e Otimizar Endereços</span>
                </>
              )}
            </button>
          </div>

          {/* Right Column: Output & Routing */}
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-medium text-zinc-800 mb-1">Rota Otimizada</h2>
              <p className="text-sm text-zinc-500 mb-4">
                Endereços extraídos e ordenados. Você pode remover itens se necessário.
              </p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[calc(100%-8rem)] min-h-[16rem]">
              <div className="p-4 border-b border-zinc-200 bg-zinc-50/50">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-zinc-700">Endereço de Coleta (Opcional)</label>
                  <button
                    onClick={handleGetCurrentLocation}
                    disabled={isGettingLocation}
                    className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                    title="Usar minha localização atual"
                  >
                    {isGettingLocation ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Navigation size={12} />
                    )}
                    <span>Meu Local</span>
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Package size={16} className="text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    placeholder="Ex: Centro de Distribuição, Rua X..."
                    className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-lg shadow-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm text-zinc-700"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <AnimatePresence mode="popLayout">
                  {addresses.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col items-center justify-center text-zinc-400 p-8 text-center"
                    >
                      <MapPin size={48} className="mb-4 opacity-20" />
                      <p>Nenhum endereço extraído ainda.</p>
                      <p className="text-sm mt-1">Insira dados e clique em extrair.</p>
                    </motion.div>
                  ) : (
                    <ul className="space-y-2">
                      {addresses.map((address, index) => (
                        <motion.li
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                          key={`${address}-${index}`}
                          className="flex items-start gap-3 p-3 bg-zinc-50 border border-zinc-100 rounded-lg group hover:border-zinc-300 transition-colors"
                        >
                          <div className="flex-shrink-0 mt-0.5 text-zinc-400">
                            <div className="w-6 h-6 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-xs font-medium text-zinc-600 shadow-sm">
                              {index + 1}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-zinc-700 leading-relaxed break-words">
                              {address}
                            </p>
                          </div>
                          <button
                            onClick={() => handleRemoveAddress(index)}
                            className="flex-shrink-0 text-zinc-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Remover endereço"
                          >
                            <Trash2 size={16} />
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </AnimatePresence>
              </div>
              
              <div className="p-4 bg-zinc-50 border-t border-zinc-200">
                <button
                  onClick={openFullRoute}
                  disabled={addresses.length === 0 && !pickupAddress}
                  className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <MapPin size={18} />
                  <span>Roteirizar Todos</span>
                </button>
                
                <div className="mt-3 flex items-center justify-center gap-2">
                  <input
                    type="checkbox"
                    id="autoClear"
                    checked={autoClear}
                    onChange={(e) => setAutoClear(e.target.checked)}
                    className="rounded border-zinc-300 text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="autoClear" className="text-sm text-zinc-600 cursor-pointer select-none">
                    Limpar dados após abrir o mapa
                  </label>
                </div>
                
                <AnimatePresence>
                  {locationNotice && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      className="flex items-center justify-center gap-1.5 text-xs text-red-600 font-medium"
                    >
                      <MapPin size={14} />
                      <span>{locationNotice}</span>
                    </motion.div>
                  )}
                  {clearNotice && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      className="flex items-center justify-center gap-1.5 text-xs text-red-600 font-medium"
                    >
                      <CheckCircle2 size={14} />
                      <span>{clearNotice}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
