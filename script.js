    require([
      "esri/Map",
      "esri/views/SceneView",
      "esri/Graphic",
      "esri/layers/GraphicsLayer",
      "esri/widgets/BasemapGallery",
      "esri/layers/GeoJSONLayer",
      "esri/layers/FeatureLayer",
      "esri/layers/TileLayer",
      "esri/geometry/geometryEngineAsync",
      "esri/widgets/Sketch/SketchViewModel",
      "esri/geometry/geometryEngine"
    ], function(Map, SceneView, Graphic, GraphicsLayer, BasemapGallery, GeoJSONLayer, FeatureLayer, TileLayer, geometryEngineAsync, SketchViewModel, geometryEngine) {

      // limpador de acentos para pesquisas mais inteligentes
      window.removerAcentos = function(texto) {
            if (!texto) return "";
            return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        };


        window.obterUrlImagem = function(item) {
            const galeria = window.obterGaleriaCompleta(item);
            if (galeria.length > 0) return galeria[0].url; // Retorna a capa
            return "";
        };

        // --- MOTOR DE SALVAMENTO (Anti-Bug de 255 Caracteres) ---
        window.salvarGaleriaMobiliario = async function(id) {
            const item = window.bancoDeDadosItens.find(i => String(i.id) === String(id) || String(i.idVisual) === String(id));
            if (!item) return;
            const btn = document.getElementById('btn-salvar-galeria');
            btn.innerText = "A Enviar Anexos..."; btn.disabled = true;

            try {
                let jsonMiniatura = [];

                for (let foto of window.galeriaTemp) {
                    let attachmentIdAtual = foto.attachmentId;

                    // 1. Se for arquivo do PC, manda pro ArcGIS agora!
                    if (foto.fileId && window.arquivosPC[foto.fileId]) {
                        const formData = new FormData();
                        formData.append("attachment", window.arquivosPC[foto.fileId].file);
                        const graphicParaAnexo = { attributes: {} };
                        graphicParaAnexo.attributes[window.camadaItensNuvem.objectIdField || "OBJECTID"] = item.objectId;
                        
                        const res = await window.camadaItensNuvem.addAttachment(graphicParaAnexo, formData);
                        if (res.error) throw new Error(res.error.description);
                        
                        // 🔴 O GRANDE BUG ESTAVA AQUI: O ID da foto está em res.attachmentId
                        if (res.attachmentId) {
                            attachmentIdAtual = res.attachmentId;
                        } else {
                            // Plano de emergência
                            const anexosResult = await window.camadaItensNuvem.queryAttachments({ objectIds: [item.objectId] });
                            const lista = anexosResult[item.objectId];
                            if (lista && lista.length > 0) attachmentIdAtual = lista[lista.length - 1].id;
                        }
                    }

                    // 2. Monta o bloco minúsculo para salvar (i = ID do Anexo, d = Descrição)
                    if (attachmentIdAtual) {
                        jsonMiniatura.push({ i: attachmentIdAtual, d: foto.desc || "" });
                    } else if (foto.url && (foto.url.startsWith('http') || foto.url.startsWith('data:'))) {
                        // Mantém links de web antigos
                        jsonMiniatura.push({ u: foto.url, d: foto.desc || "" });
                    }
                }
                
                // 3. Salva de volta na coluna oficial
                item.obra_imagem = JSON.stringify(jsonMiniatura);
                window.sincronizarAtualizacaoNuvem(item);
                
                document.getElementById('modal-imagem-mobiliario').remove();
                
                if (typeof window.renderizarPainelObras === 'function') window.renderizarPainelObras();
                window.atualizarInterfaceEMapa();
                
            } catch (e) {
                alert("Erro: " + e.message);
                btn.innerText = "Tentar Novamente"; btn.disabled = false;
            }
        };

        window.obterUrlImagem = function(item) {
            const galeria = window.obterGaleriaCompleta(item);
            if (galeria.length > 0) return galeria[0].url;
            return "";
        };



      // Camada configurada para permitir elevação no relevo 3D
      const graphicsLayer = new GraphicsLayer({
        elevationInfo: {
          mode: "relative-to-ground"
        }
      });

      // --- NOVO: Camada LOCAL de Praças e Parques (Lê o teu GeoJSON) ---
      const pracasLayer = new GeoJSONLayer({
        url: "./Praças_e_Parques_Municipais.geojson", // Aponta para o teu ficheiro na pasta
        id: "pracas-parques",
        title: "Praças e Parques",
        visible: true,
        outFields: ["*"],
        // Mantemos o teu estilo verde perfeitamente igual
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-fill",
            color: [34, 197, 94, 0.4], 
            outline: { color: [21, 128, 61, 1], width: 1.5 }
          }
        }
      });

      // --- NOVO: Camada de Satélite Global da Esri ---
      const camadaSatelite = new TileLayer({
        url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        opacity: 0.15 
      });

      // =====================================================================
      // MÁGICA: CAMADA DE BAIRROS (Com Texto Inteligente no Centro)
      // =====================================================================
      window.camadaBairros = new FeatureLayer({
        url: "https://gis-smamus.portoalegre.rs.gov.br/server/rest/services/A02_SOLO_CRIADO/bairros/MapServer/0",
        id: "limites-bairros",
        title: "Limites e Bairros",
        outFields: ["*"],
        visible: false, 
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-fill",
            color: [30, 155, 17, 0.15], 
            outline: { 
              color: [30, 155, 17, 1], 
              width: 3, 
              style: "solid" 
            }
          }
        },
        // 🔴 A MÁGICA DO TEXTO (LABELING):
        labelsVisible: true,
        labelingInfo: [{
          labelExpressionInfo: { 
            expression: "Upper($feature.bairro)" 
          },
          // 🔴 O COMANDO QUE OBRIGA O TEXTO A APARECER:
          deconflictionStrategy: "none", 
          symbol: {
            type: "text",
            color: [255, 255, 255, 1], 
            haloColor: [21, 128, 61, 1], // Deixei o verde 100% forte para leitura perfeita
            haloSize: "2.5px", // Borda ligeiramente mais grossa
            font: {
              size: 8,
              family: "sans-serif",
              weight: "bold"
            }
          },
          labelPlacement: "always-horizontal" 
        }],
        elevationInfo: { mode: "on-the-ground" }
      });


      // 🛡️ NOVA CAMADA PARA O LIMITE DA CIDADE (Nasce vazia)
      const camadaLimitePOA = new GraphicsLayer({
        elevationInfo: { mode: "on-the-ground" }
      });

      // --- CRIAÇÃO DO MAPA ---
      const map = new Map({
        basemap: "dark-gray-3d", 
        ground: "world-elevation", 
        layers: [camadaSatelite, camadaLimitePOA, window.camadaBairros, graphicsLayer, pracasLayer] 
      });

      // =====================================================================
      // 🔴 OCULTADOR DE PRÉDIOS 3D (Versão Inteligente)
      // =====================================================================
      map.basemap.load().then(function() {
          
          function ocultarPredios(camadas) {
              camadas.forEach(camada => {
                  // Verifica se a camada é um objeto 3D
                  if (camada.type === "scene" || camada.type === "building") {
                      
                      const titulo = (camada.title || "").toLowerCase();
                      
                      // Só desliga se for a camada de PRÉDIOS.
                      // Isso salva a camada 3D de textos/labels da Esri!
                      if (titulo.includes("building") || titulo.includes("prédio") || titulo.includes("edifício") || titulo.includes("edificios")) {
                          camada.visible = false; 
                      }
                  }
              });
          }

          if (map.basemap.baseLayers) {
              ocultarPredios(map.basemap.baseLayers);
          }
          if (map.basemap.referenceLayers) {
              ocultarPredios(map.basemap.referenceLayers);
          }
      });

      // --- CONEXÃO DO SLIDER HTML COM A OPACIDADE DO SATÉLITE ---
      const sliderMescla = document.getElementById('slider-mescla-mapa');
      if (sliderMescla) {
        sliderMescla.addEventListener('input', function(event) {
          // O slider vai de 0 a 100. A opacidade do ArcGIS vai de 0.0 a 1.0.
          // Dividimos por 100 para converter!
          camadaSatelite.opacity = event.target.value / 100;
        });
      }

      // --- AJUSTE DE CÂMERA AQUI ---
      // Pointing the camera precisely at the broken bench location on load.
      const view = new SceneView({
        container: "mapa-container",
        map: map,
        padding: { top: 72 }, 
        camera: {
          // Point close to the object, looking from south to north
          position: [-51.163376, -30.113322, 100000], // Longitude, Latitude, Altitude
          tilt: 0, // Inclinação 3D
          heading: 0 // Apontando para o Norte
        },
        popup: {
          dockEnabled: false,
          dockOptions: { buttonEnabled: false, breakpoint: false },
          visibleElements: {
            closeButton: false,       // Esconde o botão "X"
            collapseButton: false,    // Esconde o botão de minimizar
            featureNavigation: false, // Esconde as setas de paginação
            actionBar: false          // Esconde a barra preta de ações no rodapé
          }
        }
      });
      

      // Renderiza a galeria de mapas no painel lateral
  const basemapGallery = new BasemapGallery({
    view: view,
    container: "basemap-gallery-container"
  });

// A mágica só acontece quando o mapa estiver 100% pronto
      view.when(function() {

        window.graficoDashboard = null; // Guarda o gráfico para podermos destruí-lo e recriá-lo
        window.categoriasLegendaAberta = {}; // Guarda quais cards estão com a legenda aberta

        // =====================================================================
        // FASE 2: CARREGAMENTO INSTANTÂNEO DO LIMITE MUNICIPAL (ARQUIVO ESTÁTICO)
        // =====================================================================
        fetch('./limite_poa.json')
            .then(resposta => resposta.json())
            .then(dadosGeometria => {
                
                // Reconstrói a linha 3D em menos de 50 milissegundos
                const graficoLimite = new Graphic({
                    geometry: {
                        type: "polygon",
                        rings: dadosGeometria.rings,
                        spatialReference: dadosGeometria.spatialReference
                    },
                    symbol: {
                        type: "simple-fill",
                        color: [0, 0, 0, 0], // Interior 100% transparente
                        outline: {
                            color: [30, 155, 17, 1], // Tracejado branco translúcido
                            width: 2.5,
                            style: "solid" 
                        }
                    }
                });
                
                camadaLimitePOA.add(graficoLimite);
                console.log("✅ Limite de Porto Alegre lido do arquivo instantaneamente!");
                
            })
            .catch(erro => {
                console.error("🔴 Erro ao ler o arquivo limite_poa.json. Ele está na pasta certa?", erro);
            });
        
        // --- 1. INJEÇÃO DO BOTÃO DE MAPA DIRETO NO MOTOR DO ARCGIS ---
        const btnMapaArcGIS = document.createElement("div");
        btnMapaArcGIS.id = "btn-mapa-esri"; 
        btnMapaArcGIS.className = "esri-widget esri-widget--button esri-interactive";
        btnMapaArcGIS.title = "Estilos de Mapa";
        btnMapaArcGIS.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <svg style="width: 18px; height: 18px; color: #6b7280;" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path>
                </svg>
            </div>
        `;
        btnMapaArcGIS.addEventListener("click", function() {
            if (typeof window.abrirGavetaMapa === 'function') window.abrirGavetaMapa();
        });
        view.ui.add(btnMapaArcGIS, "top-left");

        // --- 2. INJEÇÃO DO BOTÃO DE AJUDA (TOUR) DIRETO NO ARCGIS ---
        const btnAjudaArcGIS = document.createElement("div");
        btnAjudaArcGIS.id = "btn-ajuda-esri";
        btnAjudaArcGIS.className = "esri-widget esri-widget--button esri-interactive";
        btnAjudaArcGIS.title = "Rever Tutorial Interativo";
        btnAjudaArcGIS.innerHTML = `<span class="esri-icon-question"></span>`;
        
        btnAjudaArcGIS.addEventListener("click", function() {
            if (typeof window.minimizarPainel === 'function') window.minimizarPainel();
            window.iniciarTour();
        });
        view.ui.add(btnAjudaArcGIS, "top-left");

        window.clicarCardPrincipal = function(cat) {
            const focoAtual = window.categoriaFocoGlobal || window.categoriaFocoLocal;
            
            // A MÁGICA: Zera todas as legendas abertas antes de processar o novo clique
            window.categoriasLegendaAberta = {}; 
            
            // Se o card clicado NÃO for o que já estava focado, nós abrimos a legenda dele
            if (focoAtual !== cat) {
                window.categoriasLegendaAberta[cat] = true;
            }
            
            // Dispara a função original que foca no mapa (ela já redesenha os cards sozinha)
            window.focarCategoriaDashboard(cat);
        };

        window.fecharLegendaDashboard = function(cat, event) {
            // A MÁGICA: Impede que o clique na legenda ative o clique do card principal!
            if (event) event.stopPropagation(); 
            
            window.categoriasLegendaAberta[cat] = false;
            window.renderizarDashboard(true); // Redesenha apenas os cards para sumir a legenda
        };

        window.clicarCardDashboard = function(cat) {
            const focoAtual = window.categoriaFocoGlobal || window.categoriaFocoLocal;
            
            // Zera todas as legendas abertas (garante que as outras fechem automaticamente)
            window.categoriasLegendaAberta = {}; 
            
            // Se estamos selecionando um novo card, a legenda dele abre automaticamente
            if (focoAtual !== cat) {
                window.categoriasLegendaAberta[cat] = true;
            }
            
            // Dispara o foco no mapa (que automaticamente já chama o renderizarDashboard e redesenha tudo)
            window.focarCategoriaDashboard(cat);
        };

        window.toggleAbinhaLegenda = function(cat, event) {
            // A MÁGICA: Impede que o clique na seta acione o card inteiro!
            if (event) event.stopPropagation(); 
            
            // Inverte o estado: se estava fechado (false/undefined) vira true, e vice-versa
            window.categoriasLegendaAberta[cat] = !window.categoriasLegendaAberta[cat];
            
            // Redesenha apenas os cards para mostrar/esconder a abinha e girar a seta
            window.renderizarDashboard(true); 
        };

        // --- MOTOR DE FOCO DO DASHBOARD (GLOBAL E LOCAL) ---
        window.categoriaFocoGlobal = null;
        window.categoriaFocoLocal = null;

        window.focarCategoriaDashboard = function(categoria) {
            // 1. LÓGICA GLOBAL (MUNICÍPIO INTEIRO)
            if (!pracaAtivaId) {
                if (window.categoriaFocoGlobal === categoria) {
                    window.categoriaFocoGlobal = null;
                    graphicsLayer.removeAll();
                    view.goTo({ center: [-51.21, -30.03], zoom: 11, tilt: 0 }, { duration: 2000 });
                    window.renderizarDashboard(true); // Atualiza os cards
                    return;
                }
                
                window.categoriaFocoGlobal = categoria;
                graphicsLayer.removeAll(); 

                const itensGlobais = window.bancoDeDadosItens.filter(i => window.obterNomeGaveta(i.arquivo_glb) === categoria);
                if (itensGlobais.length === 0) return;

                const marcadores = itensGlobais.map(item => {
                    const isOK = item.status === 'OK';
                    const corPino = isOK ? [16, 185, 129, 0.9] : [239, 68, 68, 0.9]; 

                    return new Graphic({
                        geometry: { type: "point", longitude: item.lon, latitude: item.lat, spatialReference: { wkid: 4326 } },
                        // CORREÇÃO: Agora o 'status' viaja junto com o pino!
                        attributes: { idVisual: item.id, nome: item.nome, status: item.status },
                        symbol: {
                            type: "point-3d",
                            verticalOffset: { screenLength: 25, maxWorldLength: 100, minWorldLength: 1 },
                            callout: { type: "line", size: 1.5, color: corPino, border: { color: [255, 255, 255] } },
                            symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, material: { color: corPino }, outline: { color: "white", size: 1 }, size: 14 }]
                        }
                    });
                });

                graphicsLayer.addMany(marcadores);
                view.goTo({ target: marcadores, tilt: 35 }, { duration: 2500 });
                window.renderizarDashboard(true); // Deixa os outros cards cinzas
            } 
            // 2. LÓGICA LOCAL (DENTRO DA PRAÇA ATIVA)
            else {
                if (window.categoriaFocoLocal === categoria) {
                    window.categoriaFocoLocal = null;
                    window.atualizarInterfaceEMapa(); 
                    window.renderizarDashboard(true);
                    return;
                }
                
                window.categoriaFocoLocal = categoria;
                const graficosAlvo = [];
                
                // Remove os pinos de foco antigos se existirem
                const pinosFoco = graphicsLayer.graphics.filter(g => g.attributes && g.attributes.isFocusPin);
                graphicsLayer.removeMany(pinosFoco.toArray());

                const novosPinos = [];

                graphicsLayer.graphics.forEach(g => {
                    if (g.attributes && g.attributes.idVisual) {
                        const item = window.bancoDeDadosItens.find(i => i.id === g.attributes.idVisual);
                        
                        // Verifica se o item PERTENCE à categoria selecionada
                        if (item && window.obterNomeGaveta(item.arquivo_glb) === categoria) {
                            
                            if (g.attributes.tipo === 'modelo') {
                                g.visible = true; // Mostra o modelo 3D
                                graficosAlvo.push(g);
                                
                                // Cria o pino flutuante de foco
                                const isOK = item.status === 'OK';
                                const corPino = isOK ? [16, 185, 129, 0.95] : [239, 68, 68, 0.95]; 
                                
                                novosPinos.push(new Graphic({
                                    geometry: g.geometry.clone(),
                                    // CORREÇÃO: Inserindo os dados de hover também nos pinos locais
                                    attributes: { isFocusPin: true, idVisual: item.id, nome: item.nome, status: item.status },
                                    symbol: {
                                        type: "point-3d",
                                        verticalOffset: { screenLength: 35, maxWorldLength: 100, minWorldLength: 1 },
                                        callout: { type: "line", size: 1.5, color: corPino, border: { color: [255, 255, 255] } },
                                        symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, material: { color: corPino }, outline: { color: "white", size: 1 }, size: 14 }]
                                    }
                                }));
                            } 
                            else if (g.attributes.tipo === 'indicador') {
                                // ESCONDE O PINO ORIGINAL para não haver sobreposição com o novo pino de foco
                                g.visible = false;
                            }
                            
                        } else {
                            // Item NÃO PERTENCE à categoria -> Esconde completamente (modelos e pinos antigos)
                            g.visible = false; 
                        }
                    } else if (g.attributes && g.attributes.tipo === "clone_visual_fantasma") {
                        if (categoria === "Árvores e Vegetação") {
                            g.visible = true;
                            graficosAlvo.push(g);
                        } else {
                            g.visible = false;
                        }
                    }
                });

                graphicsLayer.addMany(novosPinos);
                graficosAlvo.push(...novosPinos); // Inclui os pinos novos na contagem do zoom

                if (graficosAlvo.length > 0) {
                    view.goTo({ target: graficosAlvo, tilt: 55 }, { duration: 2000 });
                }
                
                window.renderizarDashboard(true); // Escurece os outros cards
            }
        };

        window.toggleLegendaDashboard = function(cat, event) {
            if (event) event.stopPropagation();
            
            // Inverte o estado da abinha (se estava aberta, fecha; se estava fechada, abre)
            window.categoriasLegendaAberta[cat] = !window.categoriasLegendaAberta[cat];
            
            // Dispara também a função original de foco no mapa e atualização dos cards
            window.focarCategoriaDashboard(cat);
        };

        window.renderizarDashboard = function(apenasCards = false) {
            
            // Auto-desliga o foco se os dados gerais mudarem (como entrar ou sair de uma praça)
            if (!apenasCards) {
                window.categoriaFocoGlobal = null;
                window.categoriaFocoLocal = null;
            }
            // 1. Define os escopos (Global vs Local)
            let pracasAlvo = window.todasAsPracas || [];
            let itensAlvo = window.bancoDeDadosItens || [];
            let obrasAlvo = window.bancoDeDadosObras || [];
            let titulo = "Panorama Geral";
            let badge = "Todo o Município";

            // Se tem uma praça selecionada, filtra os dados SÓ para ela!
            if (pracaAtivaId) {
                const praca = pracasAlvo.find(p => p.idOficial === pracaAtivaId);
                titulo = praca ? praca.nome : "Detalhes da Praça";
                badge = "Dados Locais";
                
                pracasAlvo = praca ? [praca] : [];
                itensAlvo = itensAlvo.filter(i => i.praca === pracaAtivaId);
                obrasAlvo = obrasAlvo.filter(o => o.praca === pracaAtivaId);
            }

            // 2. Escreve os textos principais
            document.getElementById('dash-titulo').innerText = titulo;
            document.getElementById('dash-badge').innerText = badge;
            document.getElementById('dash-qtd-pracas').innerText = pracasAlvo.length;
            document.getElementById('dash-qtd-itens').innerText = itensAlvo.length;

            const totalOrcamento = obrasAlvo.reduce((soma, obra) => soma + (parseFloat(obra.orcamento) || 0), 0);
            document.getElementById('dash-orcamento').innerText = totalOrcamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            // 3. A MÁGICA DOS CARDS DE CATEGORIA (Gera automaticamente com base no inventário)
            const gridCategorias = document.getElementById('grid-categorias-dashboard');
            if (gridCategorias) {
                gridCategorias.innerHTML = ''; // Limpa o grid antigo
                
                // Agrupa e conta cada item usando a sua função oficial
                const contagemCategorias = {};
                itensAlvo.forEach(item => {
                    // CORREÇÃO MÁGICA: Se for uma obra e estiver concluída, pula este item e NÃO CONTA!
                    if (item.arquivo_glb && item.arquivo_glb.includes("obra_em_andamento") && item.obra_status === "Concluído") {
                        return; // O 'return' dentro do forEach faz ele pular para o próximo item
                    }

                    const cat = window.obterNomeGaveta(item.arquivo_glb);
                    
                    // Só conta se a categoria for válida
                    if (cat) {
                        if (!contagemCategorias[cat]) contagemCategorias[cat] = 0;
                        contagemCategorias[cat]++;
                    }
                });

                // Função auxiliar para gerar um SVG padronizado, limpo e com as cores do Tailwind
                const svgIcon = (path) => `<svg class="w-12 h-12 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${path}"></path></svg>`;

                // Dicionário de SVGs Profissionais (Estilo Heroicons/Técnico)
                const iconesCat = {
                    "Bancos": `<svg class="w-12 h-12 text-green-700 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M0 0h80v80H0z" fill="none" /><path fill="currentColor" fill-rule="evenodd" d="M16 20.5a2.5 2.5 0 0 1 2.5 2.5v1.5h43V23a2.5 2.5 0 0 1 5 0v1.5H70a2.5 2.5 0 0 1 0 5h-3.5v1H70a2.5 2.5 0 0 1 0 5h-3.5v1H70a2.5 2.5 0 0 1 0 5h-3.5v1H72a2.5 2.5 0 0 1 0 5h-1.5V57a2.5 2.5 0 0 1-5 0v-9.5h-51V57a2.5 2.5 0 0 1-5 0v-9.5H8a2.5 2.5 0 0 1 0-5h5.5v-1H10a2.5 2.5 0 0 1 0-5h3.5v-1H10a2.5 2.5 0 0 1 0-5h3.5v-1H10a2.5 2.5 0 0 1 0-5h3.5V23a2.5 2.5 0 0 1 2.5-2.5m2.5 9v1h43v-1zm0 7v-1h43v1zm0 5v1h43v-1z" clip-rule="evenodd" /></svg>`,                    
                    "Iluminação (Postes)": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 467 467">
                      <path d="M259.33,134.5l21.025-82.48c9.657-5.132,16.102-11.965,9.858-12.757c-7.349-0.932-12.259-2.563-15.908-4.418  c-0.935-4.169-6.292-7.865-14.309-10.424c-3.811-8.14-12.515-14.118-22.975-15.228v-5.67c0-1.945-1.577-3.523-3.523-3.523  c-1.945,0-3.522,1.577-3.522,3.523v5.67c-10.459,1.109-19.163,7.087-22.974,15.227c-8.017,2.559-13.374,6.254-14.309,10.424  c-3.649,1.855-8.559,3.487-15.909,4.419c-6.244,0.792,0.201,7.625,9.86,12.758l21.025,82.479h12.573  c8.652,10.955-16.007,18.21-0.979,30.5c0.688,0,1.376,0,2.064,0v16.036h-4.081c-1.583,0-2.863,1.284-2.863,2.863  c0,1.581,1.279,2.863,2.863,2.863h4.081v2.677h-4.081c-1.583,0-2.863,1.283-2.863,2.863c0,1.579,1.279,2.863,2.863,2.863h4.081  V298.68h-4.081c-1.583,0-2.863,1.28-2.863,2.859c0,1.583,1.279,2.863,2.863,2.863h4.081v2.68h-4.081  c-1.583,0-2.863,1.281-2.863,2.86c0,1.583,1.279,2.863,2.863,2.863h4.081v45.199L216.318,358  c-4.07,25.689-8.138,51.378-12.207,77.068h-5.693V467h70.164v-31.932h-5.692c-4.069-25.69-8.137-51.379-12.206-77.068l-5.011,0.025  v-45.22h4.083c1.581,0,2.862-1.28,2.862-2.863c0-1.579-1.281-2.86-2.862-2.86h-4.083v-2.68h4.083c1.581,0,2.862-1.28,2.862-2.863  c0-1.58-1.281-2.859-2.862-2.859h-4.083V195.165h4.083c1.581,0,2.862-1.284,2.862-2.863c0-1.581-1.281-2.863-2.862-2.863h-4.083  v-2.677h4.083c1.581,0,2.862-1.282,2.862-2.863c0-1.58-1.281-2.863-2.862-2.863h-4.083V165c0.688,0,1.376,0,2.064,0  c15.026-12.289-9.629-19.545-0.978-30.5H259.33z M222.75,56.453c3.319,1.163,6.946,1.81,10.75,1.81s7.431-0.646,10.75-1.81V123  h-21.5V56.453z M253.25,121.916V57.134c2.421,0.406,4.963,0.626,7.587,0.626c2.898,0,6.022-0.556,9.141-1.466L253.25,121.916z  M197.024,56.295c3.118,0.909,6.242,1.465,9.14,1.465c2.624,0,5.166-0.22,7.587-0.626v64.778L197.024,56.295z"/></svg>`,
                    "Lixeiras": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M8.106 2.553A1 1 0 0 1 9 2h6a1 1 0 0 1 .894.553L17.618 6H20a1 1 0 1 1 0 2h-1v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8H4a1 1 0 0 1 0-2h2.382zM14.382 4l1 2H8.618l1-2zM11 11a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0zm4 0a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0z" clip-rule="evenodd" /></svg>`,
                    "Bebedouros": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 28"><mask id="vazado-bebedouro"><rect width="20" height="28" fill="white"/><g transform="translate(2, 4) scale(0.65)" fill="black"><path d="M14,7.59V4a1,1,0,0,0-1-1H11a1,1,0,0,0-1,1V7.59A3.41,3.41,0,0,1,9,10H9a3.41,3.41,0,0,0-1,2.41V20a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V12.41A3.41,3.41,0,0,0,15,10h0A3.41,3.41,0,0,1,14,7.59Z"/></g></mask><path d="M3 2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v24a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V2z" mask="url(#vazado-bebedouro)"/></svg>`,
                    "Banheiros e Vestiários": `<svg class="w-12 h-12 text-green-700 shrink-0" xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 50 50"><path fill="currentColor" d="M6 47.5c0 1.233.768 2 2 2c1.235 0 2-.767 2-2V29h2v18.5c0 1.231.767 2 2 2s2-.767 2-2V16h1v11.314c0 2.395 3.006 2.395 3 0V15.161C20 12.515 18.094 11 15 11H7c-2.82 0-5 1.219-5 4.087V28c0 2 3 2 3 0V16h1v31.5z"/><circle cx="10.875" cy="5.125" r="4.125" fill="currentColor"/><circle cx="35.875" cy="5.125" r="4.125" fill="currentColor"/><path fill="currentColor" d="m45.913 32.5l-5.909-16.237l-.034-.167c0-.237.199-.429.447-.429c.211 0 .388.141.435.329L44.869 26.5c.267.601 1.365 1 2.087 1c.965 0 1.065-1.895 1.044-2l-4.017-10.107C43.634 13.072 41.29 11 38.615 11H33.38c-2.675 0-5.192 2.072-5.542 4.393l-3.837 10.232c-.087.199 0 1.938 1.044 1.938c.811 0 1.89-.314 2.086-1.031l3.875-10.564a.455.455 0 0 1 .422-.292c.246 0 .445.188.445.424l-.027.151l-5.758 16.251c-.012.048 0 1.2 0 1.249c0 .346.836 1.25 1.198 1.25H31v12.595c0 1.04.916 1.905 2 1.905s2-.866 2-1.905V34.491c0-.283 2-.274 2 .009v13c0 1.04.917 2 2 2c1.086 0 2-.961 2-2V35h3.869c.362 0 1.044-.904 1.044-1.25c0-.08.029-1.181 0-1.25z"/></svg>`,
                    "Monumentos Históricos":`<svg class="w-12 h-12 text-green-700 shrink-0" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">	<path d="M0 0h24v24H0z" fill="none" />	<g fill="none">		<path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z" />		<path fill="currentColor" d="M16 5.236V17h1.75c.69 0 1.25.56 1.25 1.25V20h1a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2h1v-1.75c0-.69.56-1.25 1.25-1.25H8V5.236L7.112 3.46a1.01 1.01 0 0 1 .778-1.454l3.955-.494a1.3 1.3 0 0 1 .31 0l3.955.494c.692.086 1.09.83.778 1.454z" />	</g></svg>`,
                    "Mesas de Jogo (Dama/Xadrez)": `<svg class="w-12 h-12 text-green-700 shrink-0" <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 20 20"><path d="M0 0h20v20H0z" fill="none" /><path fill="currentColor" d="M10.5 2a.5.5 0 0 0-.5.5v2.6c0 1.377.927 2.536 2.19 2.89c-.22 2.74-1.012 4.785-1.661 6.046c.184.216.357.377.492.49c.519.434.979 1.141.979 2.023A2.44 2.44 0 0 1 11.524 18H17a1.5 1.5 0 0 0 1.5-1.5v-.307c0-.348-.119-.669-.302-.932c-.54-.777-2.069-3.29-2.389-7.272A3 3 0 0 0 18 5.1V2.5a.5.5 0 0 0-.5-.5h-.75a.75.75 0 0 0-.75.75v.75a.5.5 0 0 1-1 .002V3.5l-.004-.754a.75.75 0 0 0-.75-.746h-.492a.75.75 0 0 0-.75.746L13 3.503a.5.5 0 0 1-1-.003v-.75a.75.75 0 0 0-.75-.75zm-4 3a3 3 0 0 0-2.236 5H4a1 1 0 1 0 0 2h.52c-.372 1.798-1.353 2.836-1.9 3.293c-.346.29-.62.736-.62 1.256C2 17.35 2.65 18 3.451 18H9.55c.8 0 1.45-.65 1.45-1.451c0-.52-.274-.966-.62-1.256c-.547-.457-1.528-1.495-1.9-3.293H9a1 1 0 1 0 0-2h-.264A3 3 0 0 0 6.5 5" /></svg>`,
                    "Quadras Esportivas e Canchas": `<svg class="w-12 h-12 text-green-700 shrink-0"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
	                    <path d="M0 0h24v24H0z" fill="none" />	<g fill="none"><path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" />
		                  <path fill="currentColor" d="M11 5v4.17a3.001 3.001 0 0 0-.172 5.592l.172.067V19H4a2 2 0 0 1-1.995-1.85L2 17v-1h3a2 2 0 0 0 1.995-1.85L7 14v-4a2 2 0 0 0-1.85-1.995L5 8H2V7a2 2 0 0 1 1.85-1.995L4 5zm9 0a2 2 0 0 1 2 2v1h-3a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3v1a2 2 0 0 1-2 2h-7v-4.17a3.001 3.001 0 0 0 0-5.66V5zM5 10v4H2v-4zm17 0v4h-3v-4zm-10 1a1 1 0 1 1 0 2a1 1 0 0 1 0-2" />	</g></svg>`,
                    "Pistas de Skate":  `<svg class="w-12 h-12 text-green-700 shrink-0" <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">	<path d="M0 0h24v24H0z" fill="none" />	<path fill="currentColor" d="M19.78 18.39c.15.15.22.31.22.49c0 .12-.06.29-.18.44c-.38.53-.86.94-1.45 1.24c-.59.29-1.22.44-1.9.44H7.53c-.71 0-1.36-.15-1.94-.44c-.59-.3-1.09-.71-1.46-1.24a.83.83 0 0 1-.13-.44c0-.18.07-.34.2-.49s.3-.22.51-.22c.23 0 .42.1.57.33c.41.5.94.86 1.59 1.04l2.95-3.58l-1.28-3.89c-.18-.57-.1-1.07.22-1.57L11 6.86H8.8L7 9.77L5.41 8.76L7.75 5h5.37c.42 0 .75.12 1.02.35c.26.24.44.45.53.62l.48 1.15C15.5 7.89 16 8.5 16.7 9c.7.45 1.48.69 2.33.69v1.9c-1.09 0-2.08-.27-3-.8a6.1 6.1 0 0 1-2.16-2.08l-1.71 2.7l4.05 2.52v5.66h.26c.45 0 .86-.09 1.26-.31s.73-.47.99-.78c.15-.23.33-.33.53-.33s.38.08.53.22m-5.42-3.14l-3.31-2.07l.95 3.14l-2.76 3.27h5.12zM15 1c-1.1 0-2 .9-2 2s.9 2 2 2s2-.89 2-2s-.89-2-2-2M8 21.5c-.41 0-.75.34-.75.75s.34.75.75.75s.75-.34.75-.75s-.34-.75-.75-.75m8 0c-.41 0-.75.34-.75.75s.34.75.75.75s.75-.34.75-.75s-.34-.75-.75-.75" /></svg>`,
                    "Playground Infantil": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M504.984,407.552c-4.486-4.37-10.547-6.739-16.809-6.578c-33.187,0.855-64.219-6.478-92.22-26.71 c-25.3-18.279-45.075-44.849-61.547-71.479c-9.209-14.888-17.894-33.443-42.745-52.21c-30.764-23.236-71.898-33.537-109.531-33.63 v-50.912l55.611,41.751c25.235,6.452,49.633,17.687,70.077,34.915c18.506,15.595,27.542,30.093,35.339,43.223l10.051-4.423 l5.98,29.697c12.223,17.828,24.964,32.867,39.287,44.615c1.685-3.255,2.321-7.08,1.541-10.952l-18.14-90.084 c-0.993-4.926-4.152-9.143-8.601-11.481c-4.449-2.336-9.714-2.544-14.333-0.566l-23.457,10.049 c-6.28-25.238-8.436-33.902-14.58-58.596l56.505-77.152c4.538-6.196,3.194-14.9-3.003-19.439 c-6.197-4.539-14.898-3.194-19.44,3.003l-57.133,78.01l-38.956,10.266l-76.747-57.619v-9.2c0-5.202-2.352-10.126-6.399-13.395 l-75.536-61.009c-5.327-4.302-12.935-4.302-18.263,0L6.399,108.655C2.353,111.925,0,116.848,0,122.05v337.033 c0,4.693,3.805,8.497,8.497,8.497h20.366c4.693,0,8.498-3.805,8.498-8.497v-90.074h107.411v90.074 c0,4.693,3.805,8.497,8.497,8.497h4.179c0.21,0,0.275,0,0.266,0h15.921c4.693,0,8.498-3.805,8.498-8.497V284.537 c18.986,2.052,43.324,7.407,65.79,20.479c18.565,10.803,33.309,25.424,43.879,43.523c23.311,39.917,44.09,65.968,67.373,84.471 c38.645,30.711,83.079,38.657,132.495,32.511c0.009-0.001,0.019-0.002,0.029-0.003C503.326,464.062,512,454.201,512,442.482v-18.3 C512,417.919,509.469,411.922,504.984,407.552z M144.772,339.822L144.772,339.822H37.361v-40.863h107.411V339.822z M144.772,269.771L144.772,269.771H37.361v-42.007h107.411V269.771z"/><path d="M448.619,294.203c-58.083-46.371-53.978-43.173-55.356-44.016c0.486,1.719-0.339-2.18,10.325,50.777l24.206,19.325 c7.204,5.752,17.706,4.571,23.456-2.631C457.001,310.456,455.823,299.954,448.619,294.203z"/><circle cx="271.262" cy="146.57" r="32.45"/></svg>`,                    
                    "Academia ao Ar Livre": `<svg class="w-12 h-12 text-green-700 shrink-0 <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">	<path d="M0 0h24v24H0z" fill="none" />	<path fill="currentColor" d="M20.57 14.86L22 13.43L20.57 12L17 15.57L8.43 7L12 3.43L10.57 2L9.14 3.43L7.71 2L5.57 4.14L4.14 2.71L2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57L3.43 12L7 8.43L15.57 17L12 20.57L13.43 22l1.43-1.43L16.29 22l2.14-2.14l1.43 1.43l1.43-1.43l-1.43-1.43L22 16.29z" /></svg>`,
                    "Churrasqueiras": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M29 7v3h-3v4h-4v14h-4v-14h-4v14h-4v-14h-4v-4h-3v-3h3v-3h20v3h3z"></path></svg>`,
                    "Áreas de Estar e Pergolados": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 506 514" preserveAspectRatio="xMidYMid meet"><path transform="translate(0, 514) scale(0.1, -0.1)" d="M3608 5013 c-15 -4 -18 -16 -18 -71 l0 -67 85 -85 c47 -47 85 -88 85 -91 0 -4 -27 -10 -60 -14 -42 -5 -60 -11 -60 -21 0 -21 -29 -29 -165 -48 -66 -9 -134 -19 -151 -22 -28 -5 -50 9 -224 145 -107 83 -201 151 -211 151 -42 0 -49 -10 -49 -74 l0 -61 125 -95 c92 -68 122 -96 112 -102 -8 -4 -99 -21 -201 -38 -134 -22 -190 -27 -199 -19 -7 6 -108 71 -226 145 -146 92 -222 134 -242 134 l-29 0 0 -67 1 -68 140 -85 c77 -47 143 -88 145 -92 3 -4 -18 -10 -46 -14 -27 -4 -50 -10 -50 -15 0 -5 -7 -6 -15 -3 -8 3 -57 -2 -108 -11 l-93 -17 -250 136 c-142 78 -260 136 -276 136 -25 0 -26 -2 -30 -63 l-3 -64 158 -83 c86 -45 157 -86 157 -90 0 -9 -156 -40 -231 -47 -55 -5 -59 -3 -307 121 -155 78 -263 126 -282 126 l-30 0 0 -60 0 -61 167 -79 c91 -44 164 -82 162 -84 -2 -2 -62 -14 -132 -26 -116 -19 -132 -20 -160 -7 -108 51 -515 207 -539 207 -28 0 -28 -1 -28 -58 l0 -59 143 -56 c78 -31 156 -61 172 -67 27 -11 28 -13 10 -20 -11 -4 -64 -13 -119 -21 l-98 -13 6 -50 c3 -28 6 -70 6 -92 0 -24 5 -44 13 -47 6 -2 63 2 125 11 62 8 114 13 116 11 5 -5 21 -1174 36 -2509 6 -509 11 -970 13 -1025 l2 -100 50 -8 c34 -6 67 -5 102 4 l53 12 0 252 c0 262 -13 1406 -30 2634 -5 393 -8 716 -6 718 1 2 120 -41 262 -95 142 -55 283 -107 312 -117 l52 -19 0 -55 c0 -31 3 -67 7 -80 6 -23 8 -23 79 -17 41 3 91 9 113 12 l39 6 6 -123 c4 -97 16 -2042 16 -2695 l0 -121 48 -7 c28 -3 62 -1 81 5 l32 11 -7 1474 c-5 888 -4 1474 2 1474 20 1 778 90 1108 132 224 27 351 39 353 33 2 -6 4 -841 6 -1855 l2 -1845 73 -8 c64 -7 76 -6 101 12 l28 20 8 1858 c4 1022 8 1859 9 1859 0 1 88 12 195 26 l193 25 -7 -956 c-4 -526 -10 -1291 -14 -1701 -4 -410 -6 -747 -5 -749 7 -8 103 -13 128 -7 22 5 25 
                      12 30 68 3 35 10 598 16 1253 5 655 13 1407 16 1671 l7 481 151 17 c83 9 163 19 179 22 l27 6 0 94 c0 82 -2 94 -17 94 -9 0 -70 -7 -135 -16 -66 -9 -120 -14 -121 -12 -1 2 -74 76 -161 165 l-159 161 77 12 76 13 0 114 c0 130 0 130 -82 114 -29 -5 -102 -17 -161 -27 l-109 -17 -162 162 c-88 88 -168 160 -176 160 -8 -1 -23 -3 -32 -6z m94 -375 c-7 -7 -12 -8 -12 -2 0 6 3 14 7 17 3 4 9 5 12 2 2 -3 -1 -11 -7 -17z m-182 -98 c0 -5 -10 -10 -22 -9 -22 0 -22 1 -3 9 11 5 21 9 23 9 1 1 2 -3 2 -9z m195 -30 c-3 -5 -10 -10 -16 -10 -5 0 -9 5 -9 10 0 6 7 10 16 10 8 0 12 -4 9 -10z m469 -200 c85 -80 151 -147 145 -148 -5 -2 -57 40 -115 95 -58 54 -131 122 -162 151 -31 29 -49 51 -40 50 9 -2 86 -68 172 -148z m-1214 130 c0 -5 -2 -10 -4 -10 -3 0 -8 5 -11 10 -3 6 -1 10 4 10 6 0 11 -4 11 -10z m664 -56 c3 -8 3 -26 0 -40 l-6 -24 -40 32 c-36 28 -38 33 -22 39 32 13 62 10 68 -7z m-1256 -25 c-2 -6 -7 -10 -11 -10 -4 1 -19 1 -34 2 -25 0 -26 1 -8 9 29 12 57 12 53 -1z m1060 -51 c40 -28 72 -54 72 -58 0 -8 -174 -37 -275 -46 l-70 -6 -84 53 c-46 29 -79 55 -72 57 17 6 302 49 332 51 17 1 51 -17 97 -51z m427 3 c3 -5 1 -12 -5 -16 -5 -3 -10 1 -10 9 0 18 6 21 15 7z m-2062 -38 c-7 -2 -19 -2 -25 0 -7 3 -2 5 12 5 14 0 19 -2 13 -5z m1080 -44 c48 -28 86 -54 82 -57 -3 -3 -71 -15 -152 -27 l-147 -22 -45 27 c-26 15 -68 40 -96 56 l-50 28 150 22 c83 12 155 22 160 23 6 0 50 -22 98 -50z m-1570 -26 c-7 -2 -19 -2 -25 0 -7 3 -2 5 12 5 14 0 19 -2 13 -5z m1047 -48 c50 -25 90 -50 90 -55 0 -6 -3 -10 -7 -10 -5 0 -64 -7 -133 -15 l-125 -16 -100 53 -100 52 110 17 c163 24 165 24 265 -26z m-475 -75 c50 -23 86 -44 80 -46 -5 -2 -53 -10 -105 -18 l-95 -15 -107 46 c-60 26 -105 49 -102 52 10 11 148 29 194 26 27 -1 81 -19 135 -45z m2225 21 c19 -16 32 -32 29 -35 -3 -3 -36 -8 -75 -12 -61 -5 -72 -4 -96 16 -16 12 -28 25 -28 30 0 4 28 13 63 18 34 5 64 10 67 11 3 0 21 -12 40 -28z m-480 -75 c0 -37 -5 -39 -110 -49 -15 -1 
                      -90 43 -90 54 0 6 117 25 173 28 24 1 27 -2 27 -33z m-348 -43 l50 -27 -29 -8 c-17 -4 -79 -14 -139 -21 l-109 -13 -42 26 c-23 14 -43 28 -43 31 0 4 172 30 249 38 7 0 36 -11 63 -26z m-463 -62 l55 -28 -35 -6 c-19 -3 -75 -11 -125 -18 -90 -11 -90 -11 -145 17 -29 15 -47 29 -39 31 15 4 207 30 225 31 6 1 34 -12 64 -27z m-1859 -91 c-7 -29 -8 -23 -8 35 0 58 1 64 8 35 5 -19 5 -51 0 -70z m1406 33 l59 -26 -35 -8 c-19 -4 -65 -11 -103 -14 -59 -6 -75 -4 -122 16 -30 13 -55 27 -55 30 0 5 97 20 181 28 9 0 43 -11 75 -26z"/></svg>`,
                    "Árvores e Vegetação": `<svg class="w-12 h-12 text-green-700 shrink-0" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M11 21v-4.26c-.47.17-.97.26-1.5.26C7 17 5 15 5 12.5c0-1.27.5-2.41 1.36-3.23C6.13 8.73 6 8.13 6 7.5C6 5 8 3 10.5 3c1.56 0 2.94.8 3.75 2h.25a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5q-.75 0-1.5-.21V21z" /></svg>`,
                    "Obras": `<svg class="w-12 h-12 text-green-700 shrink-0" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">	<path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M12 15c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4M8 9a4 4 0 0 0 4 4a4 4 0 0 0 4-4m-4.5-7c-.3 0-.5.21-.5.5v3h-1V3s-2.25.86-2.25 3.75c0 0-.75.14-.75 1.25h10c-.05-1.11-.75-1.25-.75-1.25C16.25 3.86 14 3 14 3v2.5h-1v-3c0-.29-.19-.5-.5-.5z" /></svg>`,
                    "Modelos personalizados": `<svg class="w-12 h-12 text-green-700 shrink-0 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path fill-rule="evenodd" clip-rule="evenodd" d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm280-120h80v-168l64 64 56-56-160-160-160 160 56 56 64-64v168Z"/></svg>`
                };

                // Ordena do que tem mais itens para o que tem menos
                const categoriasOrdenadas = Object.keys(contagemCategorias).sort((a, b) => contagemCategorias[b] - contagemCategorias[a]);

                if (categoriasOrdenadas.length === 0) {
                    gridCategorias.innerHTML = '<div class="col-span-2 text-center text-[10px] text-slate-400 py-3 border border-dashed border-slate-200 rounded-sm">Nenhum equipamento mapeado neste local.</div>';
                } else {
                    categoriasOrdenadas.forEach(cat => {
                        const qtd = contagemCategorias[cat];
                        const icone = iconesCat[cat] || iconesCat["Obras"];
                        
                        const focoAtivo = window.categoriaFocoGlobal || window.categoriaFocoLocal;
                        
                        let bgCardDash, textTitulo, textQtd, textIcone, hoverClass;

                        if (!focoAtivo || focoAtivo === cat) {
                            // ESTADO NORMAL OU ATIVO (Verde Translúcido)
                            bgCardDash = 'bg-gradient-to-r from-[#15803d]/25 via-emerald-700/15 to-green-900/20 border-emerald-200/70 shadow-[0_4px_15px_-4px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_25px_-5px_rgba(16,185,129,0.12)] hover:border-emerald-300/80 hover:-translate-y-1 opacity-100';
                            textTitulo = 'text-emerald-950 group-hover:text-emerald-700 font-extrabold';
                            textQtd = 'text-emerald-700 group-hover:text-emerald-600 text-2xl font-black';
                            textIcone = 'group-hover:scale-110 group-hover:-rotate-3 text-emerald-800'; 
                            hoverClass = 'cursor-pointer';
                        } else {
                            // ESTADO INATIVO (Cinza Desfocado)
                            bgCardDash = 'bg-slate-50/70 border-slate-200/50 shadow-sm opacity-50 hover:opacity-100 hover:bg-slate-100 transition-all';
                            textTitulo = 'text-slate-400 font-bold';
                            textQtd = 'text-slate-400 text-xl font-bold';
                            textIcone = 'text-slate-400 grayscale opacity-60';
                            hoverClass = 'cursor-pointer';
                        }

                        // Calcula quantos itens dessa categoria estão OK e quantos precisam de conserto
                        const itensDaCat = itensAlvo.filter(i => window.obterNomeGaveta(i.arquivo_glb) === cat);
                        const qtdOk = itensDaCat.filter(i => i.status === 'OK').length;
                        const qtdConserto = itensDaCat.filter(i => i.status !== 'OK').length;

                        // Verifica se a abinha de legenda deste card específico deve aparecer
                        const estaAberta = !!window.categoriasLegendaAberta[cat];
                        
                        // Define a cor da seta para acompanhar exatamente a cor do número
                        const corSeta = (!focoAtivo || focoAtivo === cat) ? 'text-emerald-700 group-hover:text-emerald-600' : 'text-slate-400';

                        // Define a setinha usando a cor dinâmica e adiciona transição suave
                        const iconeSeta = estaAberta 
                            ? `<svg class="w-5 h-5 transition-colors duration-400 ${corSeta}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"></path></svg>`
                            : `<svg class="w-5 h-5 transition-colors duration-400 ${corSeta}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>`;

                        const htmlLegenda = estaAberta ? `
                            <div class="flex items-center justify-between mt-1 pt-2.5 border-t border-slate-200/50 text-[10px] font-bold px-1 relative z-10 animate-fade-in cursor-default">
                                <div class="flex items-center gap-1.5 text-emerald-700 bg-emerald-50/80 px-2 py-0.5 rounded-md border border-emerald-200/60 shadow-sm">
                                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span>Operacionais: <strong>${qtdOk}</strong></span>
                                </div>
                                <div class="flex items-center gap-1.5 text-red-700 bg-red-50/80 px-2 py-0.5 rounded-md border border-red-200/60 shadow-sm">
                                    <span class="w-2 h-2 rounded-full bg-red-500"></span>
                                    <span>Manutenção: <strong>${qtdConserto}</strong></span>
                                </div>
                            </div>
                        ` : '';

                        // AQUI MUDOU O ONCLICK:
                        gridCategorias.innerHTML += `
                            <div onclick="window.clicarCardDashboard('${cat}')" class="group relative w-full flex flex-col p-3.5 rounded-[20px] border transition-all duration-400 overflow-hidden ${bgCardDash} ${hoverClass}" title="Clique para focar no mapa">
                                
                                <div class="flex items-center justify-between w-full">
                                    <div class="flex items-center gap-4 overflow-hidden pr-2 relative z-10">
                                        <div class="w-11 h-11 flex items-center justify-center shrink-0 [&>svg]:w-10 [&>svg]:h-10 transition-transform duration-400 drop-shadow-sm ${textIcone}">
                                            ${icone}
                                        </div>
                                        <span class="text-[12px] uppercase tracking-widest leading-tight transition-colors truncate drop-shadow-sm ${textTitulo}" title="${cat}">${cat}</span>
                                    </div>

                                    <div class="relative z-10 shrink-0 flex items-center justify-center pr-2">
                                        <span class="transition-colors drop-shadow-sm tracking-tight ${textQtd}">${qtd}</span>
                                    </div>
                                </div>

                                <!-- Setinha de Controle Manual da Legenda -->
                                <div class="w-full flex justify-center -mt-2 relative z-20">
                                    <button onclick="window.toggleAbinhaLegenda('${cat}', event)" class="p-1 hover:bg-slate-200/50 rounded-full transition-colors" title="Mostrar/Esconder Legenda">
                                        ${iconeSeta}
                                    </button>
                                </div>

                                ${htmlLegenda}
                                
                            </div>
                        `;
                    });
                }
              }

              // MÁGICA: Aborta a função aqui para não recriar o gráfico de pizza e não piscar a tela!
              if (apenasCards) return;

            // 4. Renderiza o Gráfico Pizza com Chart.js (Com cores corporativas)
            const qtdOK = itensAlvo.filter(i => i.status === "OK").length;
            const qtdConserto = itensAlvo.filter(i => i.status === "Necessita Conserto").length;
            const ctx = document.getElementById('grafico-manutencao');
            
            if (window.graficoDashboard) {
                window.graficoDashboard.destroy();
            }

            if (itensAlvo.length === 0) {
                ctx.style.display = 'none';
            } else {
                ctx.style.display = 'block';
                window.graficoDashboard = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Operacional', 'Requer Manutenção'],
                        datasets: [{
                            data: [qtdOK, qtdConserto],
                            backgroundColor: ['#166534', '#991b1b'], // Verde e Vermelho mais fechados e sérios
                            borderWidth: 0,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { size: 10 } } }
                        }
                    }
                });
            }
        };

       window.gerarRelatorioHTML = function() {
            // 1. Definição de Escopo (Global vs Praça Específica)
            let pracasAlvo = window.todasAsPracas || [];
            let itensAlvo = window.bancoDeDadosItens || [];
            let obrasAlvo = window.bancoDeDadosObras || [];
            
            let isGlobal = true;
            let tituloRelatorio = "RELATÓRIO GLOBAL DO MUNICÍPIO";
            let subtitulo = "INVENTÁRIO COMPLETO, OBRAS E ZELADORIA";
            let pracaGeo = null;

            if (typeof pracaAtivaId !== 'undefined' && pracaAtivaId) {
                isGlobal = false;
                pracaGeo = pracasAlvo.find(p => p.idOficial === pracaAtivaId);
                tituloRelatorio = pracaGeo ? `RELATÓRIO TÉCNICO: ${pracaGeo.nome.toUpperCase()}` : "RELATÓRIO DA PRAÇA";
                subtitulo = pracaGeo ? `📍 ${pracaGeo.endereco} — Bairro ${pracaGeo.bairro}` : "Dados locais consolidados";
                
                pracasAlvo = pracaGeo ? [pracaGeo] : [];
                itensAlvo = itensAlvo.filter(i => i.praca === pracaAtivaId);
                obrasAlvo = obrasAlvo.filter(o => o.praca === pracaAtivaId);
            }

            // 2. Indicadores Principais
            const totalItens = itensAlvo.length;
            const qtdOK = itensAlvo.filter(i => i.status === "OK").length;
            const qtdConserto = itensAlvo.filter(i => i.status !== "OK").length;
            const percOK = totalItens > 0 ? ((qtdOK / totalItens) * 100).toFixed(1) : 0;
            const percConserto = totalItens > 0 ? ((qtdConserto / totalItens) * 100).toFixed(1) : 0;
            
            const totalObras = obrasAlvo.length;
            const orcamentoTotal = obrasAlvo.reduce((soma, o) => soma + (parseFloat(o.orcamento) || 0), 0);

            // 3. INVENTÁRIO OFICIAL (GeoJSON da Prefeitura)
            let htmlInventarioOficial = '';
            if (!isGlobal && pracaGeo) {
                const temDado = (valor) => valor && valor.toString().trim() !== "" && valor.toString().trim() !== "0" && valor.toString().trim() !== "Não informado";
                htmlInventarioOficial = `
                    <div class="section-title">1. DADOS OFICIAIS DA PRAÇA (BASE SMAMUS)</div>
                    <table>
                        <tr>
                            <td><strong>Bancos:</strong> ${temDado(pracaGeo.bancos) ? pracaGeo.bancos : '-'}</td>
                            <td><strong>Lixeiras:</strong> ${temDado(pracaGeo.lixeiras) ? pracaGeo.lixeiras : '-'}</td>
                            <td><strong>Iluminação:</strong> ${temDado(pracaGeo.iluminacao) ? pracaGeo.iluminacao : '-'}</td>
                        </tr>
                        <tr>
                            <td><strong>Bebedouros:</strong> ${temDado(pracaGeo.bebedouros) ? pracaGeo.bebedouros : '-'}</td>
                            <td><strong>Vestiários:</strong> ${temDado(pracaGeo.vestiarios) ? pracaGeo.vestiarios : '-'}</td>
                            <td><strong>Pista de Patinação:</strong> ${temDado(pracaGeo.pistaPatinacao) ? pracaGeo.pistaPatinacao : '-'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Irrigação:</strong> ${temDado(pracaGeo.irrigacao) ? 'Sim' : 'Não / Não informado'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Monumentos:</strong> ${temDado(pracaGeo.monumentos) ? pracaGeo.monumentos : '-'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Cercamento:</strong> ${temDado(pracaGeo.cercamento) ? pracaGeo.cercamento : '-'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Ambientes / Quadras:</strong> ${temDado(pracaGeo.ambientes) ? pracaGeo.ambientes : '-'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Obras:</strong> ${temDado(pracaGeo.equipDiversos) ? pracaGeo.equipDiversos : '-'}</td>
                        </tr>
                        <tr>
                            <td colspan="3"><strong>Elementos:</strong> ${temDado(pracaGeo.elementos) ? pracaGeo.elementos : '-'}</td>
                        </tr>
                    </table>
                `;
            }

            // 4. RELATÓRIO DE OBRAS
            let htmlObras = obrasAlvo.map(o => {
                let corStatus = o.status === 'Concluído' ? '#166534' : (o.status === 'Em Execução' ? '#92400e' : '#1e40af');
                let iconeStatus = o.status === 'Concluído' ? '✓' : (o.status === 'Em Execução' ? '▶' : '○');
                
                return `
                <tr>
                    <td>
                        <strong>${o.titulo.toUpperCase()}</strong><br>
                        <span style="font-size:10px; color:#555;">${o.descricao || 'Sem descrição detalhada.'}</span>
                        ${isGlobal ? `<br><span style="font-size:9px; color:#000; font-weight:bold;">LOCAL: ${o.local.toUpperCase()}</span>` : ''}
                    </td>
                    <td>${o.empreiteira || '-'}</td>
                    <td style="white-space: nowrap;">Início: ${o.dataInicio ? o.dataInicio.split('-').reverse().join('/') : '-'}<br>Fim: ${o.dataFim ? o.dataFim.split('-').reverse().join('/') : '-'}</td>
                    <td style="color: ${corStatus}; font-weight:bold; white-space: nowrap;">${iconeStatus} ${o.status.toUpperCase()}<br><span style="color:#000;">Progresso: ${o.porcentagem}%</span></td>
                    <td style="white-space: nowrap;">R$ ${parseFloat(o.orcamento || 0).toLocaleString('pt-BR')}</td>
                </tr>
            `}).join('');
            if (htmlObras === '') htmlObras = `<tr><td colspan="5" style="text-align:center; padding: 15px; font-style: italic;">Nenhuma obra registrada.</td></tr>`;

            // 5. PAINEL DE ZELADORIA
            const itensQuebrados = itensAlvo.filter(i => i.status !== 'OK');
            let htmlZeladoria = itensQuebrados.map(i => {
                const pracaNome = window.todasAsPracas.find(p => p.idOficial === i.praca)?.nome || "Desconhecida";
                return `<li><strong>${i.nome.toUpperCase()}</strong> (Categoria: ${window.obterNomeGaveta(i.arquivo_glb)}) ${isGlobal ? `— <em>Local: ${pracaNome}</em>` : ''}</li>`;
            }).join('');
            
            if (htmlZeladoria === '') {
                htmlZeladoria = '<div class="box-alerta ok">NENHUMA AÇÃO DE MANUTENÇÃO PENDENTE DETECTADA NESTE ESCOPO.</div>';
            } else {
                htmlZeladoria = `<div class="box-alerta pendente"><ul>${htmlZeladoria}</ul></div>`;
            }

            // 6. TABELA COMPLETA DO INVENTÁRIO 3D
            let htmlMobiliarioTabela = itensAlvo.map(i => {
                const cat = window.obterNomeGaveta(i.arquivo_glb);
                const pracaNome = window.todasAsPracas.find(p => p.idOficial === i.praca)?.nome || "Desconhecida";
                const isOK = i.status === 'OK';
                
                return `
                <tr>
                    <td><strong>${i.nome.toUpperCase()}</strong></td>
                    <td>${cat.toUpperCase()}</td>
                    ${isGlobal ? `<td>${pracaNome}</td>` : ''}
                    <td class="${isOK ? 'status-ok' : 'status-alert'}">${isOK ? '✓ OPERACIONAL' : '⚠ REQUER MANUTENÇÃO'}</td>
                </tr>
                `;
            }).join('');
            if (htmlMobiliarioTabela === '') htmlMobiliarioTabela = `<tr><td colspan="${isGlobal ? 4 : 3}" style="text-align:center; padding: 15px; font-style: italic;">Nenhum mobiliário mapeado.</td></tr>`;

            // 7. MONTAGEM DO DOCUMENTO OFICIAL HTML
            const dataAtual = new Date().toLocaleString('pt-BR');
            const relatorioHTML = `
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <title>${tituloRelatorio}</title>
                    <style>
                        @media print {
                            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
                            @page { margin: 1.5cm; }
                            .no-print { display: none; }
                            .quebra-pagina { page-break-before: always; }
                        }
                        
                        /* Tipografia e Fundo - Sóbrio e Oficial */
                        body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; line-height: 1.4; max-width: 900px; margin: 0 auto; background: #fff; font-size: 11px; }
                        
                        /* Cabeçalho Timbrado */
                        .timbrado { border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
                        .timbrado-esq h1 { font-size: 14px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
                        .timbrado-esq p { margin: 2px 0 0 0; font-size: 10px; color: #333; text-transform: uppercase; }
                        .timbrado-dir { text-align: right; font-size: 9px; color: #555; }
                        
                        /* Títulos do Documento */
                        .doc-titulo { text-align: center; font-size: 16px; font-weight: bold; margin: 0 0 5px 0; }
                        .doc-subtitulo { text-align: center; font-size: 11px; margin: 0 0 30px 0; color: #333; text-transform: uppercase; }
                        
                        /* Subtítulos de Seção */
                        .section-title { background-color: #000; color: #fff; font-size: 11px; font-weight: bold; padding: 5px 8px; text-transform: uppercase; margin: 25px 0 10px 0; letter-spacing: 1px; }
                        
                        /* Caixas de Resumo (Datasheet style) */
                        .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
                        .summary-box { border: 1px solid #000; padding: 12px; }
                        .summary-title { font-size: 9px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 8px; letter-spacing: 0.5px; }
                        .summary-value { font-size: 24px; font-weight: bold; margin-bottom: 8px; }
                        .summary-details { font-size: 10px; line-height: 1.6; font-weight: bold; }
                        
                        /* Tabelas Profissionais */
                        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
                        th, td { border: 1px solid #000; padding: 8px; text-align: left; vertical-align: top; }
                        th { background-color: #f4f4f4; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; font-weight: bold; }
                        
                        /* Status Colors (Text only, no backgrounds) */
                        .status-ok { color: #166534; font-weight: bold; }
                        .status-alert { color: #991b1b; font-weight: bold; }
                        
                        /* Box de Alertas */
                        .box-alerta { border: 1px solid #000; padding: 10px; font-size: 11px; font-weight: bold; }
                        .box-alerta.ok { border-left: 4px solid #166534; }
                        .box-alerta.pendente { border-left: 4px solid #991b1b; font-weight: normal; }
                        .box-alerta ul { margin: 0; padding-left: 20px; }
                        
                        /* Rodapé */
                        .footer { margin-top: 50px; text-align: center; font-size: 9px; color: #555; border-top: 1px solid #ccc; padding-top: 10px; text-transform: uppercase; }
                        
                        .dica-print { background: #f8f9fa; border: 1px dashed #ccc; padding: 8px; text-align: center; margin-bottom: 20px; font-size: 11px; color: #555; }
                    </style>
                </head>
                <body>
                    <div class="no-print dica-print">
                        DOCUMENTO GERADO. PRESSIONE CTRL+P (OU CMD+P) PARA SALVAR EM PDF OU IMPRIMIR.
                    </div>

                    <!-- Cabeçalho Oficial -->
                    <div class="timbrado">
                        <div class="timbrado-esq">
                            <h1>PREFEITURA MUNICIPAL DE PORTO ALEGRE</h1>
                            <p>SECRETARIA DO MEIO AMBIENTE, URBANISMO E SUSTENTABILIDADE (SMAMUS)<br>SISTEMA GÊMEO DIGITAL — ZELADORIA URBANA</p>
                        </div>
                        <div class="timbrado-dir">
                            DATA DE EMISSÃO:<br><strong>${dataAtual}</strong>
                        </div>
                    </div>
                    
                    <div class="doc-titulo">${tituloRelatorio}</div>
                    <div class="doc-subtitulo">${subtitulo}</div>
                    
                    <div class="summary-grid">
                        <div class="summary-box">
                            <div class="summary-title">Mapeamento Físico (Itens 3D)</div>
                            <div class="summary-value">${totalItens}</div>
                            <div class="summary-details">
                                <span class="status-ok">OPERACIONAL: ${percOK}%</span><br>
                                <span class="status-alert">REQUER MANUTENÇÃO: ${percConserto}%</span>
                            </div>
                        </div>
                        <div class="summary-box">
                            <div class="summary-title">Portfólio de Obras e Projetos</div>
                            <div class="summary-value">${totalObras}</div>
                            <div class="summary-details">
                                ORÇAMENTO ALOCADO:<br>
                                R$ ${orcamentoTotal.toLocaleString('pt-BR')}
                            </div>
                        </div>
                    </div>

                    ${htmlInventarioOficial}

                    <div class="section-title">2. AÇÕES DE ZELADORIA REQUERIDAS</div>
                    ${htmlZeladoria}

                    <div class="section-title">3. DETALHAMENTO DE OBRAS E CONTRATOS</div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 35%">Projeto / Descrição Técnica</th>
                                <th style="width: 20%">Empreiteira Responsável</th>
                                <th style="width: 15%">Cronograma</th>
                                <th style="width: 15%">Status da Obra</th>
                                <th style="width: 15%">Orçamento Previsto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${htmlObras}
                        </tbody>
                    </table>

                    <div class="quebra-pagina"></div>

                    <div class="section-title">4. ESPELHO DO INVENTÁRIO 3D (MOBILIÁRIO)</div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 40%">Especificação do Item</th>
                                <th style="width: 30%">Categoria / Tipologia</th>
                                ${isGlobal ? `<th style="width: 20%">Localização (Praça)</th>` : ''}
                                <th style="width: 10%">Condição</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${htmlMobiliarioTabela}
                        </tbody>
                    </table>

                    <div class="footer">
                        DOCUMENTO GERADO VIA SISTEMA GÊMEO DIGITAL — SMAMUS / PORTO ALEGRE<br>
                        ESTE RELATÓRIO REFLETE A BASE DE DADOS ESPACIAL NO EXATO MOMENTO DE SUA EMISSÃO.
                    </div>
                    
                    <script>
                        window.onload = function() { 
                            setTimeout(window.print, 500); 
                        };
                    </script>
                </body>
                </html>
            `;

            // 8. Executa a ação
            const novaAba = window.open('', '_blank');
            novaAba.document.write(relatorioHTML);
            novaAba.document.close();
        };
        
      // --- CONEXÃO COM O BANCO DE DADOS NA NUVEM (ARCGIS ONLINE) ---
        const urlMinhaCamada = "https://gis-smamus.portoalegre.rs.gov.br/server/rest/services/Hosted/Mobili%C3%A1rio_urbano_das_pra%C3%A7as/FeatureServer/0"; 
        
        window.camadaItensNuvem = new FeatureLayer({
           url: urlMinhaCamada,
           outFields: ["*"]
        });

        window.bancoDeDadosItens = []; // Começa vazio

        // --- DICIONÁRIO INTELIGENTE DE GAVETAS ---
        window.obterNomeGaveta = function(arquivo_glb) {
            if (!arquivo_glb || arquivo_glb.trim() === "") {
                return null;
            }

            const arq = arquivo_glb.toLowerCase();

            // 🔴 A NOVA SANFONA EXCLUSIVA (Agora reconhece os salvos na nuvem também!)
            if (arq.startsWith('custom_') || arq.startsWith('nuvem|')) return "Modelos personalizados";
            
            // 🔴 Adicionamos 'banco', 'lixeira', 'bebedouro', etc., para blindar as buscas
            if (arq.includes('bench') || arq.includes('banco')) return "Bancos";
            if (arq.includes('trash') || arq.includes('lixeira')) return "Lixeiras";
            if (arq.includes('fountain') || arq.includes('bebedouro')) return "Bebedouros";
            
            // 🔴 Adicionamos 'banheiro' e 'toilet'
            if (arq.includes('toilet') || arq.includes('vestiario') || arq.includes('banheiro')) return "Banheiros e Vestiários";
            
            if (arq.includes('statue') || arq.includes('monument')) return "Monumentos Históricos";
            if (arq.includes('chess') || arq.includes('jogo')) return "Mesas de Jogo (Dama/Xadrez)";
            
            // 🔴 Adicionamos 'campo', 'futsal', 'quadra', 'beach', 'volei'
            if (arq.includes('court') || arq.includes('sahasi') || arq.includes('bocha') || arq.includes('tenis') || arq.includes('volei') || arq.includes('beach') || arq.includes('campo') || arq.includes('futsal') || arq.includes('quadra')) return "Quadras Esportivas e Canchas";
            
            if (arq.includes('skate') || arq.includes('halfpipe')) return "Pistas de Skate";
            if (arq.includes('playground') || arq.includes('seesaw') || arq.includes('slide')) return "Playground Infantil";
            
            // 🔴 Adicionamos 'ginastica'
            if (arq.includes('calisthenics') || arq.includes('gym') || arq.includes('academia') || arq.includes('ginastica')) return "Academia ao Ar Livre";
            
            if (arq.includes('barbecue') || arq.includes('churrasqueira')) return "Churrasqueiras";
            if (arq.includes('pergola') || arq.includes('estar')) return "Áreas de Estar e Pergolados";
            
            // 🔴 Adicionamos 'poste'
            if (arq.includes('lamp_post') || arq.includes('street_lamp') || arq.includes('streetlight') || arq.includes('poste')) return "Iluminação (Postes)";
            
            // 🔴 Adicionamos 'floresta' por segurança
            if (arq.includes('tree') || arq.includes('palm') || arq.includes('pine') || arq.includes('floresta')) return "Árvores e Vegetação";
            
            return "Obras";
        };

       // --- FOCO BIDIRECIONAL BLINDADO ---
        window.focarObjetoNoMapa = function(id) {
          const itemBanco = window.bancoDeDadosItens.find(i => String(i.id) === String(id));
          
          // 🔴 Se for uma área de floresta, voa direto para as coordenadas salvas no banco
          if (itemBanco && itemBanco.arquivo_glb === "area_floresta_tree") {
              view.goTo({ target: [itemBanco.lon, itemBanco.lat], zoom: 19, tilt: 60 }, { duration: 1500 });
              piscarCard(id);
              return;
          }

          // Se for um item normal, acha o gráfico no mapa 3D
          const graphic = graphicsLayer.graphics.find(g => g.attributes && g.attributes.idVisual === id && g.attributes.tipo === "modelo");
          
          if (graphic) {
            view.goTo({ target: graphic, zoom: 20.5, tilt: 60 }, { duration: 1500 });
            piscarCard(id);
          }

          function piscarCard(idCard) {
            const card = document.getElementById(`card-item-${idCard}`);
            if (card) {
                card.classList.add('border-purple-500', 'ring-2', 'ring-purple-300', 'bg-purple-50');
                setTimeout(() => card.classList.remove('border-purple-500', 'ring-2', 'ring-purple-300', 'bg-purple-50'), 2000);
            }
          }
        };

        // --- MOTORES DE SINCRONIZAÇÃO COM A NUVEM ---
        window.sincronizarAdicaoNuvem = function(novoItem, geometriaExata) {
          const graphicNovo = new Graphic({
            geometry: geometriaExata,
            attributes: {
              praca_id: novoItem.praca,
              nome: novoItem.nome,
              arquivo_glb: novoItem.arquivo_glb,
              status: novoItem.status,
              escala: novoItem.escala,
              rotacao: novoItem.rotacao,
              rolagem: novoItem.rolagem,
              altitude: novoItem.altitude,
              inclinacao: novoItem.inclinacao || 0,
              obra_titulo: novoItem.obra_titulo || novoItem.titulo || null,
              obra_imagem: novoItem.obra_imagem || novoItem.imagem || null,
              obra_empreiteira: novoItem.obra_empreiteira || novoItem.empreiteira || null,
              obra_orcamento: novoItem.obra_orcamento !== undefined ? parseFloat(novoItem.obra_orcamento) : (novoItem.orcamento ? parseFloat(novoItem.orcamento) : null),
              obra_inicio: novoItem.obra_inicio || novoItem.dataInicio || null,
              obra_fim: novoItem.obra_fim || novoItem.dataFim || null,
              obra_status: novoItem.obra_status || novoItem.statusObra || null,
              obra_progresso: novoItem.obra_progresso !== undefined ? novoItem.obra_progresso : (novoItem.porcentagem || null),
              obra_desc: novoItem.obra_desc || novoItem.descricao || null,
              obra_checklist: novoItem.obra_checklist || novoItem.checklist || "[]"
            }
          });
          
          graphicNovo.geometry.z = novoItem.altitude || 0;
          
          window.camadaItensNuvem.applyEdits({ addFeatures: [graphicNovo] }).then(async function(resultado) {
            if (resultado.addFeatureResults.length > 0 && resultado.addFeatureResults[0].objectId) {
              const idOficial = resultado.addFeatureResults[0].objectId;
              novoItem.objectId = idOficial;
              novoItem.id = idOficial; 
              
              // ==========================================================
              // 🔴 O GRANDE MOTOR DE HOSPEDAGEM 3D (AGORA COM O ID CORRETO)
              // ==========================================================
              if (novoItem.arquivo_glb.startsWith('custom_') && window.modeloFisicoGLB) {
                  try {
                      console.log("Subindo o arquivo GLB para o ArcGIS...");
                      const formData = new FormData();
                      formData.append("attachment", window.modeloFisicoGLB);

                      const configEnvio = { attributes: {} };
                      configEnvio.attributes[window.camadaItensNuvem.objectIdField || "OBJECTID"] = idOficial;

                      // 1. Sobe o arquivo como anexo
                      const resAnexo = await window.camadaItensNuvem.addAttachment(configEnvio, formData);
                      
                      // 2. A CORREÇÃO: Pega o ID de todas as formas possíveis!
                      let idDoAnexo = resAnexo.objectId || resAnexo.attachmentId;
                      
                      if (!idDoAnexo) {
                          // Plano B: Se o ArcGIS não devolver o ID na hora, a gente pergunta pra ele!
                          const anexosResult = await window.camadaItensNuvem.queryAttachments({ objectIds: [idOficial] });
                          const lista = anexosResult[idOficial];
                          if (lista && lista.length > 0) {
                              idDoAnexo = lista[lista.length - 1].id;
                          }
                      }

                      if (idDoAnexo) {
                          // 3. Monta o link oficial permanente do servidor
                          let urlBase = window.camadaItensNuvem.url;
                          if (window.camadaItensNuvem.layerId !== undefined && !urlBase.endsWith("/" + window.camadaItensNuvem.layerId)) {
                              urlBase += "/" + window.camadaItensNuvem.layerId;
                          }
                          
                          // Injeta ?name=modelo.glb para o mapa entender que é um arquivo 3D
                          const fullUrl = `${urlBase}/${idOficial}/attachments/${idDoAnexo}?name=modelo.glb`;
                          const novaTag = `nuvem|${fullUrl}`;

                          // 4. Atualiza a memória e o banco de dados com o link permanente (nuvem|https...)
                          novoItem.arquivo_glb = novaTag; 
                          const graphicUpdate = { attributes: {} };
                          graphicUpdate.attributes[window.camadaItensNuvem.objectIdField || "OBJECTID"] = idOficial;
                          graphicUpdate.attributes.arquivo_glb = novaTag;

                          await window.camadaItensNuvem.applyEdits({ updateFeatures: [graphicUpdate] });
                          console.log("✅ Modelo 3D hospedado e link salvo no banco com sucesso!");
                      } else {
                          console.error("🔴 Falha ao obter o ID do anexo GLB do servidor.");
                      }
                  } catch (err) {
                      console.error("🔴 Erro ao subir o modelo 3D:", err);
                  }
                  window.modeloFisicoGLB = null; // Esvazia o tanque
              }
              // ==========================================================

              if (pracaAtivaId === novoItem.praca) window.atualizarInterfaceEMapa();
            } else if (resultado.addFeatureResults.length > 0 && resultado.addFeatureResults[0].error) {
              console.error("🔴 Servidor rejeitou adição:", resultado.addFeatureResults[0].error);
            }
          }).catch(err => console.error("🔴 Erro de rede:", err));
        };

window.sincronizarAtualizacaoNuvem = function(item, geometriaNova = null) {
  if (!item.objectId) return; 
  
  const nomeColunaId = window.camadaItensNuvem.objectIdField || "OBJECTID";
  
  // Monta os atributos que serão enviados para a nuvem
  const atributosEdicao = {
      praca_id: item.praca,
      nome: item.nome,
      arquivo_glb: item.arquivo_glb,
      status: item.status,
      escala: item.escala,
      rotacao: item.rotacao,
      altitude: item.altitude,
      inclinacao: item.inclinacao || 0,
      
      // 🌟 AQUI ESTÁ A MÁGICA: Enviando a imagem e os campos de obra para a nuvem!
      obra_imagem: item.obra_imagem || "",
      obra_titulo: item.obra_titulo || "",
      obra_empreiteira: item.obra_empreiteira || "",
      obra_orcamento: item.obra_orcamento || 0,
      obra_inicio: item.obra_inicio ? new Date(item.obra_inicio).getTime() : null, // Converte data de volta para milissegundos
      obra_fim: item.obra_fim ? new Date(item.obra_fim).getTime() : null,         // Converte data de volta para milissegundos
      obra_status: item.obra_status || "Planejado",
      obra_progresso: item.obra_progresso || 0,
      obra_desc: item.obra_desc || "",
      obra_checklist: item.obra_checklist || "[]",
      obra_galeria: item.obra_galeria || "[]",
      rolagem: item.rolagem || 0
  };
  
  atributosEdicao[nomeColunaId] = item.objectId;

  const graphicEditado = { attributes: atributosEdicao };
  
  // MÁGICA: Só envia geometria se você "MOVER" o objeto. Isso impede o servidor de rejeitar as outras edições!
  if (geometriaNova) {
      graphicEditado.geometry = geometriaNova;
      graphicEditado.geometry.z = item.altitude || 0;
  }

  window.camadaItensNuvem.applyEdits({ updateFeatures: [graphicEditado] }).then((res) => {
     if(res.updateFeatureResults.length > 0 && res.updateFeatureResults[0].error) {
         console.error("🔴 Servidor rejeitou atualização:", res.updateFeatureResults[0].error);
     } else {
         console.log("🔵 Atualizado na nuvem com sucesso!");
     }
  }).catch(err => console.error("🔴 Erro de rede:", err));
};

        window.sincronizarDelecaoNuvem = function(objectId) {
          if (!objectId) return;
          
          // O comando deleteFeatures exige que a propriedade se chame rigidamente "objectId"
          window.camadaItensNuvem.applyEdits({ 
              deleteFeatures: [{ objectId: objectId }] 
          }).then((res) => {
             if(res.deleteFeatureResults.length > 0 && res.deleteFeatureResults[0].error) {
                 console.error("🔴 Servidor rejeitou deleção:", res.deleteFeatureResults[0].error);
             } else {
                 console.log("🟠 Deletado da nuvem com sucesso!");
             }
          }).catch(err => console.error("🔴 Erro de rede na deleção:", err));
        };

        // Suga os dados da nuvem assim que o mapa abre
        window.camadaItensNuvem.queryFeatures({ where: "1=1", outFields: ["*"], returnGeometry: true }).then(function(results) {
           
           window.bancoDeDadosItens = results.features.map(f => {
              let idReal = null;
              for (const key in f.attributes) {
                  if (key.toLowerCase() === 'objectid' || key.toLowerCase() === 'fid') { idReal = f.attributes[key]; break; }
              }
              idReal = idReal || f.attributes.OBJECTID || Math.floor(Math.random() * 1000000);
              
              // 🔴 A MÁGICA DA SEGURANÇA: Se não tiver geometria, cria uma falsa para não travar o sistema!
              const geometriaSegura = f.geometry || { longitude: 0, latitude: 0, x: 0, y: 0 };
              
              return {
                 objectId: idReal,
                 id: idReal,
                 praca: f.attributes.praca_id,
                 nome: f.attributes.nome,
                 arquivo_glb: f.attributes.arquivo_glb,
                 status: f.attributes.status,
                 escala: f.attributes.escala || 1,
                 rotacao: f.attributes.rotacao || 0,
                 altitude: f.attributes.altitude || 0,
                 inclinacao: f.attributes.inclinacao || 0, 
                 rolagem: f.attributes.rolagem || 0,
                 
                 // 🔴 LÊ DA GEOMETRIA SEGURA EM VEZ DA DIRETA
                 lon: geometriaSegura.longitude || geometriaSegura.x, 
                 lat: geometriaSegura.latitude || geometriaSegura.y,
                 geometriaOriginal: f.geometry,
                 
                 // --- LENDO OS CAMPOS DE OBRA DO SEU BANCO DE DADOS ---
                 obra_titulo: f.attributes.obra_titulo,
                 obra_imagem: f.attributes.obra_imagem,
                 obra_galeria: f.attributes.obra_galeria_nova || f.attributes.obra_galeria,
                 obra_empreiteira: f.attributes.obra_empreiteira,
                 obra_orcamento: f.attributes.obra_orcamento,
                 obra_inicio: f.attributes.obra_inicio, 
                 obra_fim: f.attributes.obra_fim,
                 obra_status: f.attributes.obra_status,
                 obra_progresso: f.attributes.obra_progresso,
                 obra_desc: f.attributes.obra_descricao_nova || f.attributes.obra_desc,
                 obra_checklist: f.attributes.obra_checklist_novo || f.attributes.obra_checklist
              };
           });

           // --- MÁGICA: CRIA A LISTA DE OBRAS PUXANDO DIRETO DA NUVEM ---
           // Filtra apenas os itens que tem título de obra preenchido
           window.bancoDeDadosObras = window.bancoDeDadosItens
             .filter(i => i.obra_titulo && i.obra_titulo.trim() !== "")
             .map(i => {
                // O ArcGIS devolve datas em milissegundos (Epoch). Convertendo para "YYYY-MM-DD" pro HTML
                const formataData = (epoch) => {
                   if(!epoch) return "";
                   const d = new Date(epoch);
                   return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                };
                
                return {
                   id: i.id, 
                   praca: i.praca,
                   local: window.todasAsPracas.find(p => p.idOficial === i.praca)?.nome || "Praça Desconhecida",
                   titulo: i.obra_titulo,
                   imagem: i.obra_imagem,
                   empreiteira: i.obra_empreiteira,
                   orcamento: i.obra_orcamento || "0", 
                   dataInicio: formataData(i.obra_inicio),
                   dataFim: formataData(i.obra_fim),
                   status: i.obra_status || "Planejado",
                   porcentagem: i.obra_progresso || 0,
                   descricao: i.obra_desc || "",
                   lon: i.lon,
                   lat: i.lat
                };
             });

           console.log(`✅ Sucesso: ${window.bancoDeDadosItens.length} itens (e ${window.bancoDeDadosObras.length} obras) carregados da nuvem!`);
           
           window.renderizarPainelObras(); // Renderiza o painel lateral de obras com dados da nuvem
           if (pracaAtivaId) window.atualizarInterfaceEMapa();

        }).catch(erro => console.error("🔴 Erro ao ler da nuvem:", erro));
      
        // --- VARIÁVEIS DE CONTROLE DE ESTADO (Recuperadas) ---
        let pracaAtivaId = null;
        let modoInteracaoMapa = null; 
        let idItemSendoMovido = null;
        let idMenu3DAberto = null;

        // --- FUNÇÃO UNIFICADORA DE ID E NOME DE PRAÇAS ---
        function extrairIdENomePraca(attr) {
          const nomeOriginal = attr.denominaç || attr.denomina_1 || "Praça sem nome";
          // Garante um ID estável usando as colunas do GeoJSON
          let idFinal = attr.cod || attr.OBJECTID || attr.FID || attr.fid || "sem-id";
          let nomeFinal = nomeOriginal;

          const nomeMin = nomeOriginal.toLowerCase();
          // Mantém os IDs fixos que conversam com o seu banco de obras fictício
          if (nomeMin.includes("matriz")) { idFinal = "Matriz"; nomeFinal = "Praça da Matriz"; }
          else if (nomeMin.includes("alfândega") || nomeMin.includes("alfandega")) { idFinal = "Alfandega"; nomeFinal = "Praça da Alfândega"; }
          else if (nomeMin.includes("farroupilha") || nomeMin.includes("redenção")) { idFinal = "Redencao"; nomeFinal = "Parque Farroupilha (Redenção)"; }
          else if (nomeMin.includes("carlesso")) { idFinal = "Carlesso"; nomeFinal = "Praça Antônio Carlesso"; }

          return { id: idFinal.toString(), nome: nomeFinal };
        }

        // --- NOVO: LER TODAS AS PRAÇAS DO ARQUIVO PARA A LISTA ---
        window.todasAsPracas = [];
        
        pracasLayer.when(() => {
          const query = pracasLayer.createQuery();
          query.where = "1=1"; 
          query.outFields = ["*"];
          query.returnGeometry = true;
          
          pracasLayer.queryFeatures(query).then(function(results) {
            window.todasAsPracas = results.features.map(f => {
              const attr = f.attributes;
              const lon = f.geometry.extent ? f.geometry.extent.center.longitude : -51.2;
              const lat = f.geometry.extent ? f.geometry.extent.center.latitude : -30.0;
              
              const infoPraca = extrairIdENomePraca(attr);

              return {
                nome: infoPraca.nome,
                bairro: attr.bairro_ofi || "Bairro não informado",
                endereco: attr.endereço_ || attr.endereço1 || "Endereço não informado",
                lon: lon,
                lat: lat,
                idOficial: infoPraca.id,
                bancos: attr.banco || attr.bancos || "",
                lixeiras: attr.lixeira || attr.lixeiras || "",
                iluminacao: attr.iluminaç || "",
                ambientes: attr.ambientes || "",
                bebedouros: attr.bebedouro || 0,
                // --- OS NOVOS ITENS ESCONDIDOS DA PREFEITURA ---
                vestiarios: attr.vestiário || 0,
                monumentos: attr.monumentos || "",
                cercamento: attr.cercamento || "",
                pistaPatinacao: attr.pista_de_p || 0,
                irrigacao: attr.irrigaçã || 0,
                elementos: attr.elementos || "",
                equipDiversos: attr.equip_dive || "",
                geometriaPoligono: f.geometry,
                extent: f.geometry.extent
              };
            });
            
            window.todasAsPracas.sort((a, b) => a.nome.localeCompare(b.nome));
            renderizarListaPracas();
          });
        });

       // --- SISTEMA DE RENDERIZAÇÃO E FILTRO DA LISTA E MAPA ---
        window.renderizarListaPracas = function(termo = "") {
          const divLista = document.getElementById('lista-pracas-dinamica');
          divLista.innerHTML = '';
          
          const termoMin = termo.toLowerCase();
          const termoMaiusculo = termo.toUpperCase();
          const termoCapitalizado = termo.charAt(0).toUpperCase() + termo.slice(1).toLowerCase();

          // ==================================================================
          // AÇÃO 1 (Movida para o topo): FILTRAR A LISTA HTML DA GAVETA
          // ==================================================================
          const termoNorm = window.removerAcentos(termo);
          const filtradas = window.todasAsPracas.filter(p => 
            window.removerAcentos(p.nome).includes(termoNorm) || 
            window.removerAcentos(p.bairro).includes(termoNorm) || 
            window.removerAcentos(p.endereco).includes(termoNorm)
          );

          // ==================================================================
          // AÇÃO 2: ACENDER O BAIRRO NO MAPA (Agora Inteligente com Acentos)
          // ==================================================================
          if (window.camadaBairros) {
              if (termo.trim() === "") {
                  window.camadaBairros.visible = false;
                  window.camadaBairros.definitionExpression = null;
              } else {
                  window.camadaBairros.visible = true;
                  
                  // Extrai os nomes perfeitos (com acento) das praças já filtradas
                  const bairrosEncontrados = [...new Set(filtradas.map(p => p.bairro))].filter(b => b !== "Bairro não informado");
                  
                  if (bairrosEncontrados.length > 0) {
                      const bairrosSQL = bairrosEncontrados.map(b => `'${b.replace(/'/g, "''")}'`).join(",");
                      window.camadaBairros.definitionExpression = `bairro IN (${bairrosSQL})`;
                  } else {
                      window.camadaBairros.definitionExpression = "1=0"; // Esconde se nada bater
                  }
              }
          }

          // ==================================================================
          // AÇÃO 3: FILTRAR AS PRAÇAS NO MAPA 3D
          // ==================================================================
          view.whenLayerView(pracasLayer).then(function(layerView) {
              if (termo.trim() === "") {
                  layerView.filter = null; // Mostra todas
              } else {
                  const nomesEncontrados = filtradas.map(p => `'${p.nome.replace(/'/g, "''")}'`).join(",");
                  if (nomesEncontrados.length > 0) {
                      layerView.filter = { where: `denominaç IN (${nomesEncontrados}) OR denomina_1 IN (${nomesEncontrados})` };
                  } else {
                      layerView.filter = { where: "1=0" }; // Esconde tudo se não achou nada
                  }
              }
          });
          
          const limite = filtradas.slice(0, 50);
          
          if (limite.length === 0) {
            divLista.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Nenhuma praça encontrada com este termo.</p>';
            return;
          }
          
          limite.forEach(p => {
            const nomeSeguro = p.nome.replace(/'/g, "\\'");
            const idSeguro = p.idOficial.toString().replace(/'/g, "\\'");

            // O mesmo gradiente translúcido elegante que aplicamos no resto do sistema
            const bgCardPraca = 'from-[#15803d]/25 via-emerald-700/15 to-green-900/20';

            divLista.innerHTML += `
              <div onclick="abrirGestaoPraca('${idSeguro}', '${nomeSeguro}', ${p.lon}, ${p.lat})" class="group relative w-full flex items-center justify-between p-4 mb-3.5 bg-gradient-to-r ${bgCardPraca} backdrop-blur-sm rounded-[20px] border border-emerald-200/70 shadow-[0_4px_15px_-4px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_25px_-5px_rgba(16,185,129,0.12)] hover:border-emerald-300/80 hover:-translate-y-1 transition-all duration-400 cursor-pointer overflow-hidden" title="Acessar Gestão da Praça">
                
                <div class="flex flex-col flex-1 min-w-0 pr-4 relative z-10">
                    <h3 class="font-extrabold text-[15px] text-emerald-950 leading-tight group-hover:text-emerald-700 transition-colors truncate w-full drop-shadow-sm">${p.nome}</h3>
                    
                    <div class="flex items-center gap-1.5 mt-1.5">
                        <svg class="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <p class="text-[10px] text-emerald-800/80 truncate w-full tracking-wide">
                            <span class="font-black text-emerald-800 uppercase tracking-widest">${p.bairro}</span> 
                            <span class="text-emerald-800/30 mx-1.5">|</span> 
                            ${p.endereco}
                        </p>
                    </div>
                </div>
                
                <!-- Botãozinho na direita (Seta) combinando com os botões de controle -->
                <div class="relative z-10 shrink-0 flex items-center justify-center p-2.5 bg-white/60 rounded-[12px] shadow-sm border border-emerald-100/50 group-hover:border-emerald-300 group-hover:bg-white transition-all duration-300">
                    <svg class="w-4 h-4 text-emerald-700 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                    </svg>
                </div>
                
              </div>
            `;
          });
        };

        // 🔴 MOTOR DE VOO PARA BAIRROS (Agora inteligente com acentos)
        window.voarParaBairro = function(termo) {
            if (!termo || termo.trim() === "" || !window.camadaBairros) return;
            
            // Busca o nome real do bairro (com acento) usando a nossa inteligência JS
            const termoNorm = window.removerAcentos(termo);
            const pracaAlvo = window.todasAsPracas.find(p => window.removerAcentos(p.bairro).includes(termoNorm));
            
            let expressaoSQL = `UPPER(bairro) LIKE '%${termo.toUpperCase()}%'`;
            
            if (pracaAlvo && pracaAlvo.bairro !== "Bairro não informado") {
                // Se achou uma praça nesse bairro, usa o nome escrito com a acentuação perfeita
                expressaoSQL = `bairro = '${pracaAlvo.bairro.replace(/'/g, "''")}'`; 
            }

            const query = window.camadaBairros.createQuery();
            query.where = expressaoSQL;
            query.returnGeometry = true;
            window.camadaBairros.queryFeatures(query).then(function(results) {
                if (results.features.length > 0) {
                    view.goTo({
                        target: results.features[0].geometry.extent.clone().expand(1.5), 
                        tilt: 25 
                    }, { duration: 2500 });
                }
            });
        };

       // --- 1. BUSCA GLOBAL NO CABEÇALHO ---
        const inputGlobal = document.getElementById('input-pesquisa-global');
        if (inputGlobal) {
          inputGlobal.addEventListener('input', (e) => {
            const termo = e.target.value;
            renderizarListaPracas(termo);
            
            // Espelha o texto para a barra da gaveta
            const inputLocal = document.getElementById('input-pesquisa-local');
            if (inputLocal) inputLocal.value = termo;
            
            if (termo.trim() !== "") {
                const contentInventario = document.getElementById('content-inventario');
                if (contentInventario && contentInventario.classList.contains('hidden')) {
                    const btnInv = document.getElementById('btn-inventario');
                    if (btnInv) btnInv.click();
                }
                const telaGestao = document.getElementById('tela-gestao-praca');
                if (telaGestao && !telaGestao.classList.contains('hidden')) {
                    window.voltarParaListaPracas();
                }
            }
          });
          inputGlobal.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { window.voarParaBairro(e.target.value); e.target.blur(); }
          });
        }

        // --- 2. BUSCA LOCAL DENTRO DA GAVETA ---
        const inputLocal = document.getElementById('input-pesquisa-local');
        if (inputLocal) {
          inputLocal.addEventListener('input', (e) => {
            const termo = e.target.value;
            renderizarListaPracas(termo);
            
            // Espelha o texto para a barra do cabeçalho
            const inputGlob = document.getElementById('input-pesquisa-global');
            if (inputGlob) inputGlob.value = termo;
          });
          inputLocal.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { window.voarParaBairro(e.target.value); e.target.blur(); }
          });
        }

        // --- NOVA FUNÇÃO: VOA PARA A PRAÇA (Auto-Enquadramento) ---
        window.voarParaPraca = function(lon, lat) {
          event.stopPropagation(); // Impede que o clique abra a tela de gestão sem querer
          
          // Encontra a praça pela coordenada para descobrir as bordas dela
          const pracaGeo = window.todasAsPracas.find(p => p.lon === lon && p.lat === lat);

          if (pracaGeo && pracaGeo.extent) {
              view.goTo({ 
                  target: pracaGeo.extent.clone().expand(1.4), 
                  tilt: 45 
              }, { duration: 2000 });
          } else {
              view.goTo({ target: [lon, lat], zoom: 19.5, tilt: 45 }, { duration: 2000 });
          }
        };

        // --- NOVA FUNÇÃO: ABRIR/FECHAR BUSCA MOBILE ---
        window.toggleBuscaMobile = function() {
            const popup = document.getElementById('popup-busca-mobile');
            popup.classList.toggle('hidden');
            if(!popup.classList.contains('hidden')) {
                document.getElementById('input-pesquisa-mobile').focus();
            }
        };

        // --- INTEGRAÇÃO DO INPUT MOBILE ---
        const inputMobile = document.getElementById('input-pesquisa-mobile');
        if (inputMobile) {
          inputMobile.addEventListener('input', (e) => {
            const termo = e.target.value;
            window.renderizarListaPracas(termo);
            
            // Mantém os outros inputs sincronizados
            const inputLocal = document.getElementById('input-pesquisa-local');
            if (inputLocal) inputLocal.value = termo;
            const inputGlob = document.getElementById('input-pesquisa-global');
            if (inputGlob) inputGlob.value = termo;
            
            // Aciona o painel de inventário automaticamente
            if (termo.trim() !== "") {
                const contentInventario = document.getElementById('content-inventario');
                if (contentInventario && contentInventario.classList.contains('hidden')) {
                    const btnInv = document.getElementById('btn-inventario');
                    if (btnInv) btnInv.click();
                }
                const telaGestao = document.getElementById('tela-gestao-praca');
                if (telaGestao && !telaGestao.classList.contains('hidden')) {
                    window.voltarParaListaPracas();
                }
            }
          });
          inputMobile.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { 
                  window.voarParaBairro(e.target.value); 
                  e.target.blur(); 
                  if (typeof window.toggleBuscaMobile === 'function') window.toggleBuscaMobile(); 
              }
          });
        }

        // --- NAVEGAÇÃO DO PAINEL DE INVENTÁRIO (Auto-Enquadramento Inteligente) ---
        window.abrirGestaoPraca = function(idPraca, nomePraca, lon, lat) {
          pracaAtivaId = idPraca;
          document.getElementById('tela-lista-pracas').classList.add('hidden');
          document.getElementById('tela-gestao-praca').classList.remove('hidden');
          document.getElementById('titulo-praca-ativa').innerText = nomePraca;
          window.alternarAbaPraca('geral')

          // 1. Busca a praça na memória para descobrir o tamanho real do polígono dela
          const pracaGeo = window.todasAsPracas.find(p => p.idOficial === idPraca);

          // 2. A Mágica: Deixa o ArcGIS calcular a altitude ideal da câmera
          if (pracaGeo && pracaGeo.extent) {
              view.goTo({ 
              target: pracaGeo.extent.clone().expand(1.4), 
              tilt: 45 
          }, { duration: 2000 });
      } else {
          view.goTo({ target: [lon, lat], zoom: 19.5, tilt: 45 }, { duration: 2000 });
      }
      
      window.atualizarInterfaceEMapa();
      window.renderizarPainelObras(); // 🔴 INTEGRAÇÃO: Avisa o painel de obras para se atualizar!
    };

        window.voltarParaListaPracas = function() {
          pracaAtivaId = null; // Remove o foco globalmente
          cancelarAcaoMapa();
          graphicsLayer.removeAll();
          
          view.whenLayerView(pracasLayer).then(function(layerView) {
            layerView.filter = null;
          });

          // 1. Reseta a aba de INVENTÁRIO
          document.getElementById('tela-lista-pracas').classList.remove('hidden');
          document.getElementById('tela-gestao-praca').classList.add('hidden');
          
          if (typeof window.renderizarDashboard === 'function') window.renderizarDashboard();

          // 2. 🔴 INTEGRAÇÃO: Reseta a OBRA junto (Volta tudo ao zero)
          const telaListaObras = document.getElementById('tela-lista-obras');
          const telaDetalheObra = document.getElementById('tela-detalhe-obra');
          const telaFormObra = document.getElementById('tela-formulario-obra');
          
          if (telaListaObras) telaListaObras.classList.remove('hidden');
          if (telaDetalheObra) telaDetalheObra.classList.add('hidden');
          if (telaFormObra) telaFormObra.classList.add('hidden');
          
          window.renderizarPainelObras(); // Restaura a lista de obras completa
        };
       // Auxiliar para as cores dinâmicas dos status (Dark Glass com Neon)
        function obterCorStatusObra(status) {
          if (status === "Planejado") return "bg-slate-900/80 text-sky-400 border-sky-500/40 shadow-[0_0_10px_rgba(56,189,248,0.2)]";
          if (status === "Em Execução") return "bg-slate-900/80 text-amber-400 border-amber-500/40 shadow-[0_0_10px_rgba(251,191,36,0.2)]";
          if (status === "Concluído") return "bg-slate-900/80 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(52,211,153,0.2)]";
          return "bg-slate-900/80 text-slate-300 border-slate-500/40 shadow-[0_0_10px_rgba(148,163,184,0.2)]";
        }
       // --- NOVA FUNÇÃO: VOA PARA A OBRA SEM ABRIR A EDIÇÃO ---
        window.voarParaObra = function(lon, lat, event) {
          event.stopPropagation(); // A mágica: Impede que o clique abra a tela de edição do card
          view.goTo({ 
            target: [lon, lat], 
            zoom: 17, 
            tilt: 45 
          }, { 
            duration: 2000 
          });
        };

        // --- NOVO MOTOR DO PAINEL DE OBRAS (COM INTEGRAÇÃO 3D) ---
        window.filtroObrasAtivo = 'Todos';

        window.filtrarObras = function(status) {
          window.filtroObrasAtivo = status;
          
          // Estiliza as pílulas de filtro
          const classesInativas = "flex-1 text-[10px] font-bold py-1.5 rounded-lg transition bg-white text-gray-500 border border-transparent hover:bg-gray-50";
          ['Todos', 'Em Execução', 'Planejado', 'Concluído'].forEach(s => {
             const btn = document.getElementById(`btn-filtro-obra-${s.replace(' ', '')}`);
             if (btn) {
               if (s === status) {
                 btn.className = "flex-1 text-[10px] font-bold py-1.5 rounded-lg transition bg-gray-800 text-white shadow-sm border border-gray-800";
               } else {
                 btn.className = classesInativas;
               }
             }
          });
          window.renderizarPainelObras();
        };

        // 🔴 AQUI ESTÁ A FUNÇÃO DE LIMPAR O FILTRO (AGORA NO LUGAR CERTO)
        window.limparFiltroPracaObras = function() {
          // 1. Zera o foco da praça no sistema
          pracaAtivaId = null;
          
          // 2. Limpa o mapa 3D e tira o isolamento visual da praça
          cancelarAcaoMapa();
          graphicsLayer.removeAll();
          view.whenLayerView(pracasLayer).then(function(layerView) {
            layerView.filter = null;
          });

          // 3. Reseta a aba de Inventário (que fica nos bastidores)
          const telaLista = document.getElementById('tela-lista-pracas');
          const telaGestao = document.getElementById('tela-gestao-praca');
          if (telaLista) telaLista.classList.remove('hidden');
          if (telaGestao) telaGestao.classList.add('hidden');
          
          // 4. Limpa a barra de pesquisa de obras para evitar conflitos
          const inputPesquisaObras = document.getElementById('input-pesquisa-obras');
          if (inputPesquisaObras) inputPesquisaObras.value = "";
          
          // 5. Manda a aba de obras se desenhar de novo (agora mostrando todas)
          window.renderizarPainelObras();
        };

        window.renderizarPainelObras = function() {
          const divObras = document.getElementById('lista-todas-obras');
          const divVoltar = document.getElementById('container-voltar-obras');
          const divAviso = document.getElementById('container-aviso-praca-obras'); // Novo controlador da caixa verde
          
          let conteudoCards = ''; 
          if (divVoltar) divVoltar.innerHTML = ''; // Limpa o topo 
          if (divAviso) divAviso.innerHTML = '';   // Limpa a caixa inferior

          let obrasFiltradas = window.bancoDeDadosItens.filter(i => i.obra_titulo && i.obra_titulo.trim() !== "");

          // 🔴 A MÁGICA DO TOPO: Separa o botão de voltar e a caixa verde da praça
          if (pracaAtivaId) {
              obrasFiltradas = obrasFiltradas.filter(o => String(o.praca) === String(pracaAtivaId));
              const praca = window.todasAsPracas.find(p => p.idOficial === pracaAtivaId);
              const nomePraca = praca ? praca.nome : 'Praça selecionada';

              // INJETA SÓ O BOTÃO (Fica acima do título principal)
              if (divVoltar) {
                  divVoltar.innerHTML = `
                    <button onclick="window.limparFiltroPracaObras()" class="text-[10px] text-gray-500 font-bold mb-4 flex items-center hover:text-emerald-600 transition-colors uppercase tracking-widest gap-1 -ml-1 cursor-pointer relative z-50">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg> 
                      Voltar para todas as obras
                    </button>
                  `;
              }
              
              // INJETA SÓ A CAIXA VERDE (Fica abaixo do título principal)
              if (divAviso) {
                  divAviso.innerHTML = `
                    <div class="mb-5 w-full bg-gradient-to-r from-[#15803d]/60 via-emerald-800/50 to-green-950/60 backdrop-blur-2xl py-3 px-4 rounded-xl shadow-md border border-white/25 text-center">
                       <span class="text-[8px] font-black text-emerald-200 uppercase tracking-widest block mb-1 drop-shadow-sm">Obras localizadas em:</span>
                       <h3 style="font-family: 'Orbitron', sans-serif;" class="text-[14px] font-black uppercase tracking-widest bg-gradient-to-r from-green-300 to-emerald-500 bg-clip-text text-transparent leading-tight inline-block drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">${nomePraca}</h3>
                    </div>
                  `;
              }
          }

          // Filtro de Status
          if (window.filtroObrasAtivo !== 'Todos') {
             obrasFiltradas = obrasFiltradas.filter(o => o.obra_status === window.filtroObrasAtivo);
          }

          // Filtro de Pesquisa (Agora sem acentos)
          const inputPesquisa = document.getElementById('input-pesquisa-obras');
          if (inputPesquisa && inputPesquisa.value.trim() !== "") {
              const termo = window.removerAcentos(inputPesquisa.value);
              obrasFiltradas = obrasFiltradas.filter(o => 
                  (o.obra_titulo && window.removerAcentos(o.obra_titulo).includes(termo)) ||
                  (o.obra_empreiteira && window.removerAcentos(o.obra_empreiteira).includes(termo)) ||
                  (o.nome && window.removerAcentos(o.nome).includes(termo))
              );
          }

          if (obrasFiltradas.length === 0) {
            divObras.innerHTML = '<p class="text-sm text-gray-500 text-center py-6 mt-4">Nenhuma obra encontrada com estes filtros.</p>';
            return;
          }

          obrasFiltradas.forEach(obra => {
            const cor = obterCorStatusObra(obra.obra_status);

            // Define o gradiente de fundo dinâmico e a cor da barrinha
            let bgCardObra = 'from-slate-100/50 via-white to-slate-50/30';
            let hoverBorderObra = 'hover:border-slate-300';
            let titleHover = 'group-hover:text-slate-900';
            let bgProgresso = 'from-slate-400 to-slate-500';
            
            if (obra.obra_status === "Concluído") {
                bgCardObra = 'from-[#15803d]/30 via-emerald-800/15 to-green-950/20'; 
                hoverBorderObra = 'hover:border-emerald-300';
                titleHover = 'group-hover:text-emerald-800';
                bgProgresso = 'from-emerald-400 to-emerald-600';
            } else if (obra.obra_status === "Em Execução") {
                bgCardObra = 'from-[#b45309]/20 via-amber-800/10 to-orange-950/15'; 
                hoverBorderObra = 'hover:border-amber-300';
                titleHover = 'group-hover:text-amber-900';
                bgProgresso = 'from-amber-400 to-amber-500';
            } else if (obra.obra_status === "Planejado") {
                bgCardObra = 'from-[#1d4ed8]/20 via-blue-800/10 to-sky-950/15'; 
                hoverBorderObra = 'hover:border-blue-300';
                titleHover = 'group-hover:text-blue-900';
                bgProgresso = 'from-blue-400 to-blue-600';
            }

            conteudoCards += `
              <div onclick="abrirDetalheObra(${obra.id})" class="group relative flex items-center gap-3 p-2 bg-gradient-to-r ${bgCardObra} rounded-xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] border border-slate-200/60 cursor-pointer overflow-hidden transition-all duration-300 hover:shadow-[0_8px_20px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 ${hoverBorderObra} mt-2.5">
                
                <!-- Esquerda: Miniatura Quadrada (56x56px) -->
                <div class="w-14 h-14 shrink-0 relative rounded-lg overflow-hidden bg-slate-100 border border-white/50 shadow-inner">
                    <img src="${window.obterUrlImagem(obra)}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt="Foto da Obra">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                </div>

                <!-- Direita: Informações Ultra Enxutas -->
                <div class="flex-1 min-w-0 flex flex-col justify-center py-0.5">
                    
                    <!-- Linha 1: Local -->
                    <div class="flex items-center gap-1 min-w-0 mb-1">
                        <svg class="w-3 h-3 text-slate-500 shrink-0 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <span class="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate drop-shadow-sm">${obra.nome}</span>
                    </div>

                    <!-- Linha 2: Título da Obra + Badge de Status -->
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                        <h4 class="text-[12px] font-extrabold text-slate-800 leading-tight truncate ${titleHover} transition-colors">${obra.obra_titulo}</h4>
                        
                        <div class="flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-black rounded uppercase border ${cor} tracking-widest shrink-0 shadow-sm leading-none bg-white/50 backdrop-blur-sm">
                            <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse shadow-[0_0_5px_currentColor]"></span>
                            ${obra.obra_status}
                        </div>
                    </div>

                    <!-- Linha 3: Mini Barra de Progresso Super Fina -->
                    <div class="flex items-center gap-2 mt-0.5">
                        <div class="w-16 bg-slate-200/80 rounded-full h-1.5 overflow-hidden shadow-inner shrink-0 border border-slate-300/50">
                            <div class="bg-gradient-to-r ${bgProgresso} h-full rounded-full" style="width: ${obra.obra_progresso}%"></div>
                        </div>
                        <span class="font-black text-slate-600 text-[9.5px]">${obra.obra_progresso}%</span>
                    </div>

                </div>

                <!-- Seta de Ação Discreta -->
                <div class="shrink-0 text-slate-400 group-hover:text-slate-800 transition-colors pr-1">
                    <svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                </div>
                
              </div>
            `;
          });
          divObras.innerHTML = conteudoCards;
        };

        // --- MOTOR DO CARROSSEL DE OBRAS ---
        window.indiceCarrosselObra = 0;
        window.navegarCarrosselObra = function(idObra, direcao, event) {
            if(event) event.stopPropagation(); // Impede cliques indesejados no fundo
            const obra = window.bancoDeDadosItens.find(i => i.id === idObra);
            if(!obra) return;

            const galeria = window.obterGaleriaCompleta(obra);
            if(galeria.length <= 1) return;

            window.indiceCarrosselObra += direcao;

            // Lógica do loop infinito (vai do fim pro começo e vice-versa)
            if(window.indiceCarrosselObra < 0) {
                window.indiceCarrosselObra = galeria.length - 1;
            } else if(window.indiceCarrosselObra >= galeria.length) {
                window.indiceCarrosselObra = 0;
            }

            const imgEl = document.getElementById(`img-capa-obra-${idObra}`);
            const contEl = document.getElementById(`contador-carrossel-obra-${idObra}`);

            // Transição visual suave
            if(imgEl) {
                imgEl.style.opacity = 0.5;
                setTimeout(() => {
                    imgEl.src = galeria[window.indiceCarrosselObra].url;
                    imgEl.style.opacity = 1;
                }, 150);
            }
            if(contEl) {
                contEl.innerText = `${window.indiceCarrosselObra + 1} /${galeria.length}`;
            }
        };

    window.abrirDetalheObra = function(id) {
    const obra = window.bancoDeDadosItens.find(i => i.id === id);
    if(!obra) return;

    // A MÁGICA DA CORREÇÃO: Esconde a lista e o FORMULÁRIO, mostra apenas o detalhe
    document.getElementById('tela-lista-obras').classList.add('hidden');
    document.getElementById('tela-formulario-obra').classList.add('hidden'); // <--- ESTA LINHA FALTAVA!
    document.getElementById('tela-detalhe-obra').classList.remove('hidden');

    const cor = obterCorStatusObra(obra.obra_status);
    const pracaNome = window.todasAsPracas.find(p => p.idOficial === obra.praca)?.nome || "Praça Desconhecida";
    const formataData = (epoch) => {
       if(!epoch) return "Não def.";
       const d = new Date(epoch);
       return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0].split('-').reverse().join('/');
    };
    
    // Formata o dinheiro no padrão BRL
    const orcamentoFormatado = parseFloat(obra.obra_orcamento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    // 1. MÁGICA DE ESTILIZAÇÃO DOS BOTÕES EXTERNOS (Ícones minimalistas)
    const btnVoltar = document.querySelector('#tela-detalhe-obra button[onclick="voltarParaListaObras()"]');
    if (btnVoltar) {
        btnVoltar.className = "text-xs text-slate-500 font-bold flex items-center hover:text-emerald-600 hover:bg-emerald-50 px-2 py-1.5 rounded-lg transition-colors uppercase tracking-wider gap-1";
        btnVoltar.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg> Voltar`;
    }
    
    const btnHistorico = document.getElementById('btn-historico-obra-ativa');
    if (btnHistorico) {
        btnHistorico.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        btnHistorico.onclick = function() { window.abrirModalLogObra(id); };
    }
    
    const btnEditar = document.getElementById('btn-editar-obra-ativa');
    if (btnEditar) {
        btnEditar.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>`;
    }

    const btnDeletar = document.getElementById('btn-deletar-obra-ativa');
    if (btnDeletar) {
        btnDeletar.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`;
    }

    // --- LÓGICA DO CHECKLIST E DESCRIÇÃO ---
    // Removemos a gambiarra, agora pega a descrição limpa direto do banco!
    let descExibicao = obra.obra_desc || 'Nenhuma descrição fornecida para o projeto.';

    let listaTarefas = [];
    try { 
        let parsed = JSON.parse(obra.obra_checklist || '[]'); 
        if (Array.isArray(parsed)) listaTarefas = parsed;
        else if (parsed.t) listaTarefas = parsed.t; // Lê o formato comprimido (t = tarefas)
        else if (parsed.tarefas) listaTarefas = parsed.tarefas; // Lê formato antigo
    } catch(e) {}

    let htmlChecklist = '';
    if (listaTarefas.length === 0) {
        // AQUI ESTAVA O ERRO DAS CRASES FALTANDO:
        htmlChecklist = `<p class="text-[11px] text-slate-400 italic mt-3 bg-slate-50 p-3 rounded-xl border border-slate-100">Nenhuma etapa cadastrada neste projeto.</p>`;
    } else {
        htmlChecklist = '<ul class="mt-4 space-y-2">';
        listaTarefas.forEach((tarefa, index) => {
            const isChecked = tarefa.ok ? 'checked' : '';
            const textClass = tarefa.ok ? 'line-through text-slate-400' : 'text-slate-700 font-bold';
            const bgClass = tarefa.ok ? 'bg-slate-50/50 border-slate-200/50' : 'bg-white border-slate-200 shadow-sm hover:border-emerald-300';
            
            htmlChecklist += `
                <li class="flex items-center justify-between p-3 rounded-xl border transition-all ${bgClass}">
                    <label class="flex items-center gap-3 cursor-pointer flex-1">
                        <input type="checkbox" ${isChecked} onchange="window.toggleTarefaChecklist(${obra.id}, ${index}, this.checked)" class="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer">
                        <span class="text-[11px] uppercase tracking-wider ${textClass} transition-all">${tarefa.texto}</span>
                    </label>
                    <button onclick="window.removerTarefaDireto(${obra.id}, ${index})" class="text-slate-300 hover:text-red-500 transition px-2" title="Excluir Etapa">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </li>
            `;
        });
        htmlChecklist += '</ul>';
    }
    
    // 2. CONSTRUÇÃO DO NOVO LAYOUT DO CONTEÚDO
    window.indiceCarrosselObra = 0; // Zera o contador sempre que abrir a obra
    const galeriaObra = window.obterGaleriaCompleta(obra);
    const temCarrossel = galeriaObra.length > 1;
    const imgCapaInicial = galeriaObra.length > 0 ? galeriaObra[0].url : "";

    document.getElementById('conteudo-detalhe-obra').innerHTML = `
      
      <!-- HEADER IMERSIVO COM FOTO E TÍTULO -->
      <div class="relative w-full h-48 rounded-2xl overflow-hidden shadow-md mb-5 border border-emerald-100/50 group select-none">
          <img id="img-capa-obra-${obra.id}" src="${imgCapaInicial}" class="w-full h-full object-cover transition-all duration-300 cursor-pointer" onclick="window.abrirVisualizadorFotos('${obra.id}')" title="Clique para abrir a galeria">
          
          <!-- Gradiente escuro para dar leitura aos textos -->
          <div class="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent pointer-events-none"></div>
          
          ${temCarrossel ? `
            <!-- Seta Esquerda -->
            <button onclick="window.navegarCarrosselObra(${obra.id}, -1, event)" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 text-white rounded-full p-1.5 backdrop-blur-sm transition-all z-20 opacity-0 group-hover:opacity-100 shadow-sm border border-white/20 outline-none">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <!-- Seta Direita -->
            <button onclick="window.navegarCarrosselObra(${obra.id}, 1, event)" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 text-white rounded-full p-1.5 backdrop-blur-sm transition-all z-20 opacity-0 group-hover:opacity-100 shadow-sm border border-white/20 outline-none">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
            </button>
          ` : ''}

          <!-- NOVO: Controles Top-Left (Botão de Galeria e Contador) -->
          <div class="absolute top-3 left-3 flex items-center gap-2 z-20">
              <button onclick="window.abrirVisualizadorFotos('${obra.id}')" class="bg-black/50 hover:bg-black/80 border border-white/20 backdrop-blur-md text-white p-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center group/btn" title="Abrir Galeria em Tela Cheia">
                  <svg class="w-4 h-4 group-hover/btn:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              </button>
              
              ${temCarrossel ? `
              <div id="contador-carrossel-obra-${obra.id}" class="bg-black/50 border border-white/20 backdrop-blur-md text-white font-bold text-[9px] px-2.5 py-1.5 rounded-full shadow-sm pointer-events-none flex items-center leading-none">
                  1 / ${galeriaObra.length}
              </div>
              ` : ''}
          </div>

          <!-- Badge de Status (O mesmo Dark Glass com LED dos cards) -->
          <div class="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black rounded-full uppercase backdrop-blur-md border ${cor} tracking-widest shadow-lg z-10 pointer-events-none">
              <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse shadow-[0_0_5px_currentColor]"></span>
              ${obra.obra_status}
          </div>

          <!-- Textos Flutuantes -->
          <div class="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
              <div class="flex items-center gap-1.5 mb-1">
                  <svg class="w-4 h-4 text-emerald-400 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  <span class="text-[11px] font-extrabold text-emerald-50 uppercase tracking-widest drop-shadow-md">${pracaNome}</span>
              </div>
              <h2 class="text-lg font-black text-white leading-tight drop-shadow-lg">${obra.obra_titulo}</h2>
          </div>
      </div>

      <!-- PROGRESSO FÍSICO EM DESTAQUE -->
      <div class="bg-white/90 backdrop-blur-xl p-4 rounded-2xl border border-emerald-100/60 shadow-sm mb-4">
          <div class="flex justify-between items-center mb-2.5">
             <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                 <svg class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                 Avanço Físico
             </span>
             <span class="text-sm font-black text-emerald-600">${obra.obra_progresso}%</span>
           </div>
           <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/60 shadow-inner">
             <div class="bg-gradient-to-r from-emerald-400 via-emerald-500 to-green-600 h-full rounded-full transition-all duration-1000 relative" style="width: ${obra.obra_progresso}%">
               <!-- Brilho holográfico na ponta da barra -->
               <div class="absolute right-0 top-0 bottom-0 w-4 bg-white/40 blur-[2px]"></div>
             </div>
           </div>
      </div>

      <!-- FICHA TÉCNICA (Resumo Contratual) -->
      <div class="bg-gradient-to-br from-slate-50 to-emerald-50/30 p-4 rounded-2xl border border-emerald-100/60 shadow-sm mb-4 relative overflow-hidden">
          <!-- Brilho de fundo -->
          <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
          
          <h3 class="text-[10px] font-bold text-emerald-800 uppercase tracking-widest mb-4 flex items-center gap-1.5 relative z-10">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              Ficha Técnica
          </h3>
          
          <div class="grid grid-cols-2 gap-y-4 gap-x-3 relative z-10">
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Orçamento Base</span>
                <span class="font-black text-slate-800 text-[13px]">R$ ${orcamentoFormatado}</span>
            </div>
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Empreiteira Responsável</span>
                <span class="font-bold text-slate-800 text-xs truncate" title="${obra.obra_empreiteira || 'Não informada'}">${obra.obra_empreiteira || 'Não informada'}</span>
            </div>
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Data de Início</span>
                <span class="font-semibold text-slate-700 text-xs">${formataData(obra.obra_inicio)}</span>
            </div>
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Prazo de Entrega</span>
                <span class="font-semibold text-slate-700 text-xs">${formataData(obra.obra_fim)}</span>
            </div>
          </div>
      </div>

      <!-- ESCOPO DO PROJETO -->
      <div>
          <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5 pl-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
              Escopo do Projeto
          </h3>
          <p class="text-xs text-slate-600 leading-relaxed bg-white/60 p-4 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm">${descExibicao}</p>
      </div>

      <!-- CHECKLIST DINÂMICO -->
      <div class="mt-5">
          <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 pl-1">
              <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
              Etapas de Execução (Checklist)
          </h3>
          ${htmlChecklist}
      </div>
    `;
    
    document.getElementById('btn-editar-obra-ativa').onclick = function() { window.abrirFormularioObra(id); };
    document.getElementById('btn-deletar-obra-ativa').onclick = function() { window.deletarObra(id); };

    const pracaGeo = window.todasAsPracas.find(p => p.idOficial === obra.praca);
    if (pracaGeo && pracaGeo.geometriaPoligono) {
      view.whenLayerView(pracasLayer).then(function(layerView) {
        layerView.filter = { geometry: pracaGeo.geometriaPoligono, spatialRelationship: "intersects" };
        view.goTo({ target: pracaGeo.geometriaPoligono, tilt: 55, zoom: 17 }, { duration: 2500 });
      });
    }
    // 🔴 SINCRONIZAÇÃO FANTASMA (Segura, não interfere no mapa da Obra)
    if (pracaGeo) {
      // 0. FORÇA A ABERTURA DA GAVETA DE OBRAS (Muda o menu principal)
      const btnObras = document.getElementById('btn-obras');
      if (btnObras && !btnObras.classList.contains('active')) {
          btnObras.click();
      }

      // 1. Define a praça ativa globalmente
      pracaAtivaId = pracaGeo.idOficial;
      
      // 2. Prepara a tela de Inventário silenciosamente
      const tituloPraca = document.getElementById('titulo-praca-ativa');
      if (tituloPraca) tituloPraca.innerText = pracaGeo.nome;
      
      const telaLista = document.getElementById('tela-lista-pracas');
      const telaGestao = document.getElementById('tela-gestao-praca');
      
      if (telaLista) telaLista.classList.add('hidden');
      if (telaGestao) telaGestao.classList.remove('hidden');
      
      // 3. Garante que o inventário acorde na aba correta
      if (typeof window.alternarAbaPraca === 'function') {
          window.alternarAbaPraca('geral');
      }

      // 4. Injeta o resumo rápido com as CORES DINÂMICAS idênticas às originais
      const divStatus = document.getElementById('status-obra-praca');
      if (divStatus && typeof obra !== 'undefined') {
          let bordaStatus = 'border-l-slate-400';
          let corBadge = 'bg-slate-50 text-slate-600 border-slate-200';
          let ledStatus = 'bg-slate-400 shadow-[0_0_5px_#94a3b8]';
          let bgProgresso = 'from-slate-400 to-slate-500';

          const statusUpper = (obra.obra_status || "").toUpperCase();
          if (statusUpper.includes('PLANEJADO')) {
              bordaStatus = 'border-l-blue-500'; corBadge = 'bg-blue-50 text-blue-700 border-blue-200'; ledStatus = 'bg-blue-500 shadow-[0_0_5px_#3b82f6]'; bgProgresso = 'from-blue-400 to-blue-600';
          } else if (statusUpper.includes('EXECUÇÃO') || statusUpper.includes('ANDAMENTO')) {
              bordaStatus = 'border-l-amber-500'; corBadge = 'bg-amber-50 text-amber-700 border-amber-200'; ledStatus = 'bg-amber-500 shadow-[0_0_5px_#f59e0b]'; bgProgresso = 'from-amber-400 to-amber-500';
          } else if (statusUpper.includes('CONCLUÍDO')) {
              bordaStatus = 'border-l-emerald-500'; corBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200'; ledStatus = 'bg-emerald-500 shadow-[0_0_5px_#10b981]'; bgProgresso = 'from-emerald-400 to-emerald-600';
          }

          divStatus.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 border-l-[6px] ${bordaStatus} shadow-sm p-5 mb-5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" onclick="abrirDetalheObra(${obra.id})" title="Acessar painel do projeto">
              <div class="flex justify-between items-start mb-3">
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${corBadge}">
                  <span class="w-1.5 h-1.5 rounded-full ${ledStatus} animate-pulse"></span>
                  <span class="text-[9px] font-black uppercase tracking-widest">${obra.obra_status}</span>
                </div>
                <span class="text-[11px] font-black text-slate-700 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">${obra.obra_progresso || 0}%</span>
              </div>
              <h4 class="font-bold text-[15px] text-slate-800 leading-tight mb-3 line-clamp-2">${obra.obra_titulo}</h4>
              <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                 <div class="bg-gradient-to-r ${bgProgresso} h-full rounded-full transition-all duration-1000" style="width: ${obra.obra_progresso || 0}%"></div>
              </div>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-4 flex items-center gap-1">
                 Acessar Projeto <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
              </p>
            </div>`;
      }
    }

    // 🔴 A MÁGICA CORRIGIDA: Renderiza todo o inventário da praça no mapa 3D junto com a obra
    window.atualizarInterfaceEMapa(); 
    
    // Foca a câmera diretamente na obra com um zoom elegante e imersivo
    view.goTo({ 
        target: [obra.lon, obra.lat], 
        zoom: 19.5, 
        tilt: 60 
    }, { duration: 2500 });
};
          
          

        window.voltarParaListaObras = function() {
          // 1. Oculta os detalhes
          document.getElementById('tela-lista-obras').classList.remove('hidden');
          document.getElementById('tela-detalhe-obra').classList.add('hidden');
          document.getElementById('tela-formulario-obra').classList.add('hidden');
          
          // 🔴 NOVA INTELIGÊNCIA: Se estiver dentro de uma praça, recarrega apenas a praça e para por aqui!
          if (pracaAtivaId) {
              window.atualizarInterfaceEMapa();
              window.renderizarPainelObras();
              return; 
          }

          // 3. Se for contexto global (nenhuma praça clicada), limpa o mapa
          graphicsLayer.removeAll(); 
          view.whenLayerView(pracasLayer).then(function(layerView) {
            layerView.filter = null;
          });

          pracaAtivaId = null; 
          document.getElementById('tela-gestao-praca').classList.add('hidden');
          document.getElementById('tela-lista-pracas').classList.remove('hidden');
          
          const divStatus = document.getElementById('status-obra-praca');
          const divSmamus = document.getElementById('inventario-smamus-container');
          if (divStatus) divStatus.innerHTML = '';
          if (divSmamus) divSmamus.innerHTML = '';
          
          window.renderizarPainelObras(); 
        };

        // --- FUNÇÕES DE EDIÇÃO E CRIAÇÃO DE OBRAS ---
        window.preencherSelectPracas = function() {
          const select = document.getElementById('form-obra-praca');
          select.innerHTML = '<option value="">Selecione uma Praça...</option>';
          // Usa a variável global de praças para preencher o formulário
          window.todasAsPracas.forEach(p => {
            select.innerHTML += `<option value="${p.idOficial}" data-nome="${p.nome}" data-lon="${p.lon}" data-lat="${p.lat}">${p.nome}</option>`;
          });
        };

        // --- MOTOR DE GALERIA NO FORMULÁRIO DE OBRAS ---
        window.adicionarFotoObraPC = function(event) {
            const files = event.target.files;
            if(!files || files.length === 0) return;
            // Lê todos os arquivos selecionados
            for(let i=0; i<files.length; i++) {
                const file = files[i];
                const reader = new FileReader();
                reader.onload = function(e) {
                    const fileId = 'pc_obra_' + Date.now() + i;
                    window.arquivosPC[fileId] = { file: file, preview: e.target.result };
                    window.galeriaTemp.push({ url: "", desc: "", fileId: fileId });
                    window.renderizarGaleriaObraForm();
                };
                reader.readAsDataURL(file);
            }
            event.target.value = ''; // reseta o input
        };

        window.adicionarFotoObraURL = function() {
            const url = prompt("Cole o link (URL) da imagem da obra:");
            if (url && url.trim() !== "") {
                window.galeriaTemp.push({ url: url.trim(), desc: "" });
                window.renderizarGaleriaObraForm();
            }
        };

        window.removerFotoObraForm = function(index) {
            if (window.galeriaTemp[index].fileId) delete window.arquivosPC[window.galeriaTemp[index].fileId];
            window.galeriaTemp.splice(index, 1);
            window.renderizarGaleriaObraForm();
        };

        window.renderizarGaleriaObraForm = function() {
            const container = document.getElementById('lista-fotos-obra-form');
            if (!container) return;
            if (window.galeriaTemp.length === 0) {
                container.innerHTML = '<p class="text-[10px] text-gray-400 text-center italic py-3">Nenhuma foto adicionada. A primeira foto será a capa.</p>';
                return;
            }
            container.innerHTML = window.galeriaTemp.map((foto, index) => {
                const imgSrc = foto.fileId ? window.arquivosPC[foto.fileId].preview : foto.url;
                const badgeCapa = index === 0 ? '<span class="absolute -top-2 -left-2 bg-emerald-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm border border-emerald-400 uppercase">Capa</span>' : '';
                return `
                <div class="flex gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200 items-center relative">
                    <div class="relative shrink-0">
                        <img src="${imgSrc}" class="w-12 h-12 object-cover rounded-lg border border-slate-300 shadow-sm">
                        ${badgeCapa}
                    </div>
                    <div class="flex-1 flex flex-col gap-1.5">
                        <input type="text" value="${foto.desc || ''}" onchange="window.galeriaTemp[${index}].desc = this.value" placeholder="Breve descrição da foto..." class="w-full text-[10px] px-2 py-1.5 border border-slate-200 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all">
                        <div class="flex items-center gap-1.5">
                            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Data:</span>
                            <input type="date" value="${foto.data || ''}" onchange="window.galeriaTemp[${index}].data = this.value" class="flex-1 text-[10px] px-2 py-1 border border-slate-200 rounded-md focus:border-emerald-500 outline-none">
                        </div>
                    </div>
                    <button type="button" onclick="window.removerFotoObraForm(${index})" class="text-slate-400 hover:text-red-500 font-black px-2 transition-colors" title="Remover Foto">X</button>
                </div>`;
            }).join('');
        };

        window.abrirFormularioObra = function(idObra = null) {
          document.getElementById('tela-lista-obras').classList.add('hidden');
          document.getElementById('tela-detalhe-obra').classList.add('hidden');
          document.getElementById('tela-formulario-obra').classList.remove('hidden');
          
          window.preencherSelectPracas();
          
          // Zera a memória da galeria do formulário
          window.galeriaTemp = [];
          window.arquivosPC = {};

          if (idObra) {
            document.getElementById('titulo-formulario-obra').innerText = "Editar Obra";
            const obra = window.bancoDeDadosItens.find(o => o.id === idObra);
            const formataDataInput = (epoch) => {
               if(!epoch) return "";
               const d = new Date(epoch);
               return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            };

            document.getElementById('form-obra-id').value = obra.id;
            document.getElementById('form-obra-praca').value = obra.praca;
            document.getElementById('form-obra-titulo').value = obra.obra_titulo;
            document.getElementById('form-obra-empreiteira').value = obra.obra_empreiteira;
            document.getElementById('form-obra-orcamento').value = obra.obra_orcamento;
            document.getElementById('form-obra-inicio').value = formataDataInput(obra.obra_inicio);
            document.getElementById('form-obra-fim').value = formataDataInput(obra.obra_fim);
            document.getElementById('form-obra-status').value = obra.obra_status;
            document.getElementById('form-obra-progresso').value = obra.obra_progresso;
            
            // A descrição volta ao normal, sem desempacotar nada!
            document.getElementById('form-obra-desc').value = obra.obra_desc || "";

            document.getElementById('contador-desc').innerText = (obra.obra_desc || "").length + "/255";
            
            // Carrega Checklist extraindo do formato ultra-comprimido
            try { 
                let parsed = JSON.parse(obra.obra_checklist || '[]'); 
                if (Array.isArray(parsed)) window.tarefasTemp = parsed;
                else if (parsed.t) window.tarefasTemp = parsed.t;
                else if (parsed.tarefas) window.tarefasTemp = parsed.tarefas;
            } catch(e) { window.tarefasTemp = []; }
            if (typeof window.renderizarTarefasForm === 'function') window.renderizarTarefasForm();
            
            // Carrega Galeria Antiga da Obra
            window.galeriaTemp = window.obterGaleriaCompleta(obra);
            window.renderizarGaleriaObraForm();

          } else {
            document.getElementById('titulo-formulario-obra').innerText = "Nova Obra";
            document.getElementById('form-obra-id').value = "";
            document.getElementById('form-obra-praca').value = "";
            document.getElementById('form-obra-titulo').value = "";
            document.getElementById('form-obra-empreiteira').value = "";
            document.getElementById('form-obra-orcamento').value = "";
            document.getElementById('form-obra-inicio').value = "";
            document.getElementById('form-obra-fim').value = "";
            document.getElementById('form-obra-status').value = "Planejado";
            document.getElementById('form-obra-progresso').value = "0";
            document.getElementById('form-obra-desc').value = "";

            document.getElementById('contador-desc').innerText = "0/255";
            
            // Zera Checklist e Galeria
            window.tarefasTemp = [];
            if (typeof window.renderizarTarefasForm === 'function') window.renderizarTarefasForm();
            window.renderizarGaleriaObraForm();
          }
        };

        window.salvarObraNoBanco = function() {
          const idCampo = document.getElementById('form-obra-id').value;
          const selectPraca = document.getElementById('form-obra-praca');
          const optionSelecionada = selectPraca.options[selectPraca.selectedIndex];
          
          if (!optionSelecionada.value) { alert("Selecione uma praça!"); return; }

          const btnSalvar = document.querySelector('#tela-formulario-obra button[onclick="salvarObraNoBanco()"]');
          btnSalvar.innerText = "A guardar obra... (Aguarde)";
          btnSalvar.disabled = true;

          let orcamentoLimpo = parseFloat(document.getElementById('form-obra-orcamento').value.toString().replace(/\./g, '').replace(',', '.')) || 0;
          const dataInicioStr = document.getElementById('form-obra-inicio').value;
          const dataFimStr = document.getElementById('form-obra-fim').value;
          
          const atributosEdicao = {
              praca_id: optionSelecionada.value,
              nome: optionSelecionada.getAttribute('data-nome'), 
              arquivo_glb: "obra_em_andamento.glb", 
              status: "OK", 
              obra_titulo: document.getElementById('form-obra-titulo').value,
              obra_empreiteira: document.getElementById('form-obra-empreiteira').value,
              obra_orcamento: orcamentoLimpo,
              obra_inicio: dataInicioStr ? new Date(dataInicioStr).getTime() : null,
              obra_fim: dataFimStr ? new Date(dataFimStr).getTime() : null,
              obra_status: document.getElementById('form-obra-status').value,
              obra_progresso: parseInt(document.getElementById('form-obra-progresso').value) || 0,
              obra_desc: document.getElementById('form-obra-desc').value,
              obra_checklist: document.getElementById('form-obra-checklist').value || "[]"
          };

          // --- GERADOR DE LOG DE ALTERAÇÕES (COMPACTO) ---
          let logNovo = null;
          if (idCampo) {
              const itemAntigo = window.bancoDeDadosItens.find(i => i.id === parseInt(idCampo));
              if (itemAntigo) {
                  let mudancas = [];
                  
                  if ((itemAntigo.obra_desc || "") !== (atributosEdicao.obra_desc || "")) {
                      mudancas.push(`Descrição alterada`);
                  }
                  if (itemAntigo.obra_status !== atributosEdicao.obra_status) {
                      mudancas.push(`Status: ${itemAntigo.obra_status || '-'} ➔ ${atributosEdicao.obra_status}`);
                  }
                  if (itemAntigo.obra_progresso != atributosEdicao.obra_progresso) {
                      mudancas.push(`Progresso: ${itemAntigo.obra_progresso || 0}% ➔ ${atributosEdicao.obra_progresso}%`);
                  }
                  if (parseFloat(itemAntigo.obra_orcamento || 0) !== parseFloat(atributosEdicao.obra_orcamento || 0)) {
                      // Formatação curta para caber no banco (ex: R$150.000)
                      const orcAnt = parseFloat(itemAntigo.obra_orcamento || 0).toLocaleString('pt-BR');
                      const orcNovo = parseFloat(atributosEdicao.obra_orcamento || 0).toLocaleString('pt-BR');
                      mudancas.push(`Orç.: R$${orcAnt} ➔ R$${orcNovo}`);
                  }
                  if (itemAntigo.obra_titulo !== atributosEdicao.obra_titulo) {
                      let tAnt = itemAntigo.obra_titulo || '-';
                      let tNov = atributosEdicao.obra_titulo || '-';
                      // Corta o título longo para não quebrar o banco
                      if (tAnt.length > 15) tAnt = tAnt.substring(0, 15) + '...';
                      if (tNov.length > 15) tNov = tNov.substring(0, 15) + '...';
                      mudancas.push(`Título: ${tAnt} ➔ ${tNov}`);
                  }

                  if ((itemAntigo.obra_desc || "") !== (atributosEdicao.obra_desc || "")) {
                      mudancas.push(`Descrição alterada`);
                  }

                  if (mudancas.length > 0) {
                      logNovo = { d: new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}), a: "Edição", m: mudancas };
                  } else {
                      logNovo = { d: new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}), a: "Edição", m: ["Checklist/Fotos alteradas"] };
                  }
              }
          } else {
              logNovo = { d: new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}), a: "Criação", m: ["Obra cadastrada"] };
          }
          
          // MÁGICA DE COMPRESSÃO NO CHECKLIST
          let tarefasDoForm = [];
          try { tarefasDoForm = JSON.parse(document.getElementById('form-obra-checklist').value || '[]'); } catch(e) {}
          
          let logsSalvos = [];
          if (idCampo) {
              const itemAnt = window.bancoDeDadosItens.find(i => i.id === parseInt(idCampo));
              if (itemAnt) {
                  try { 
                      let parsed = JSON.parse(itemAnt.obra_checklist || '{}'); 
                      if (parsed.l) logsSalvos = parsed.l; // 'l' de logs
                      else if (Array.isArray(parsed.logs)) logsSalvos = parsed.logs;
                  } catch(e) {}
              }
          }
          
          if (logNovo) logsSalvos.push(logNovo);
          
          // Trava de segurança máxima: Guarda apenas os últimos 5 logs para não quebrar o banco da Esri
          if (logsSalvos.length > 5) logsSalvos = logsSalvos.slice(-5);
          
          // Empacota Tarefas (t) e Logs (l) economizando caracteres
          atributosEdicao.obra_checklist = JSON.stringify({ t: tarefasDoForm, l: logsSalvos });
          
          // A descrição agora vai limpa, sem estourar limite!
          atributosEdicao.obra_desc = document.getElementById('form-obra-desc').value || "";
          // ---------------------------------------

          // =======================================================
          // 🔴 TRAVA DE SEGURANÇA: ALERTA DE LIMITE DE CARACTERES
          // IMPORTANTE: Mude de 255 para 2000 após alterar lá no ArcGIS!
          // =======================================================
          const LIMITE_BANCO = 2000; 
          
          if (atributosEdicao.obra_desc.length > LIMITE_BANCO) {
              alert(`⚠️ O texto da descrição é muito grande!\n\nVocê digitou ${atributosEdicao.obra_desc.length} caracteres, mas o banco suporta apenas ${LIMITE_BANCO}. Resuma o texto ou aumente o limite no ArcGIS Online.`);
              btnSalvar.innerText = "Salvar Obra";
              btnSalvar.disabled = false;
              return; // Trava o código e não deixa mandar pro banco!
          }
          if (atributosEdicao.obra_checklist.length > LIMITE_BANCO) {
              alert(`⚠️ O checklist e o histórico ficaram muito grandes (estourou o limite de ${LIMITE_BANCO} caracteres).\n\nExclua algumas etapas do checklist ou aumente o limite no ArcGIS Online.`);
              btnSalvar.innerText = "Salvar Obra";
              btnSalvar.disabled = false;
              return; 
          }
          // =======================================================

          const finalizarESair = (idSalvo) => {
              btnSalvar.innerText = "Salvar Obra";
              btnSalvar.disabled = false;
              window.renderizarPainelObras();
              if (pracaAtivaId) window.atualizarInterfaceEMapa();
              if (idSalvo) window.abrirDetalheObra(idSalvo);
              else window.voltarParaListaObras();
          };

          // --- NOVO MOTOR ASSÍNCRONO DE GALERIA ---
          const subirGaleriaInteira = async (objectIdFinal) => {
              let jsonGaleria = [];
              for (let foto of window.galeriaTemp) {
                  if (foto.fileId && window.arquivosPC[foto.fileId]) {
                      btnSalvar.innerText = "Enviando fotos... (Aguarde)";
                      const formData = new FormData();
                      formData.append("attachment", window.arquivosPC[foto.fileId].file);
                      
                      const graphicAnexo = { attributes: {} };
                      graphicAnexo.attributes[window.camadaItensNuvem.objectIdField || "OBJECTID"] = objectIdFinal;

                      try {
                          const res = await window.camadaItensNuvem.addAttachment(graphicAnexo, formData);
                          if (!res.error) {
                              const anexos = await window.camadaItensNuvem.queryAttachments({ objectIds: [objectIdFinal] });
                              const lista = anexos[objectIdFinal];
                              if (lista && lista.length > 0) {
                                  // AGORA SALVAMOS A DATA JUNTO
                                  jsonGaleria.push({ url: lista[lista.length - 1].url, desc: foto.desc || "", data: foto.data || "" });
                              }
                          }
                      } catch(e) { console.error("Erro ao subir foto", e); }
                  } else if (foto.url) {
                      // AGORA SALVAMOS A DATA JUNTO
                      jsonGaleria.push({ url: foto.url, desc: foto.desc || "", data: foto.data || "" });
                  }
              }
              return jsonGaleria;
          };

          if (idCampo) {
            const idInt = parseInt(idCampo);
            atributosEdicao[window.camadaItensNuvem.objectIdField || "OBJECTID"] = idInt;

            subirGaleriaInteira(idInt).then((jsonFinal) => {
                atributosEdicao.obra_galeria = JSON.stringify(jsonFinal);
                atributosEdicao.obra_imagem = jsonFinal.length > 0 ? jsonFinal[0].url : ""; 

                const index = window.bancoDeDadosItens.findIndex(i => i.id === idInt);
                if(index !== -1) window.bancoDeDadosItens[index] = { ...window.bancoDeDadosItens[index], ...atributosEdicao };

                window.camadaItensNuvem.applyEdits({ updateFeatures: [{ attributes: atributosEdicao }] })
                    .then((res) => {
                        // Verifica se o servidor recusou silenciosamente
                        if (res.updateFeatureResults && res.updateFeatureResults.length > 0 && res.updateFeatureResults[0].error) {
                            alert("❌ Erro do Banco de Dados:\n" + (res.updateFeatureResults[0].error.description || res.updateFeatureResults[0].error.message || JSON.stringify(res.updateFeatureResults[0].error)));
                            btnSalvar.innerText = "Salvar Obra";
                            btnSalvar.disabled = false;
                            return; // Se deu erro, cancela e não finge que salvou!
                        }
                        finalizarESair(idInt);
                    }).catch(err => { 
                        alert("❌ Erro de conexão com a Nuvem.");
                        btnSalvar.innerText = "Salvar Obra";
                        btnSalvar.disabled = false;
                    });

            }).catch(err => { alert("Erro ao processar galeria."); finalizarESair(idInt); });

          } else {
            const graphicNovo = new Graphic({
                geometry: { type: "point", longitude: parseFloat(optionSelecionada.getAttribute('data-lon')), latitude: parseFloat(optionSelecionada.getAttribute('data-lat')), spatialReference: { wkid: 4326 } },
                attributes: atributosEdicao
            });

            // AQUI O SISTEMA LÊ O ERRO SECRETO DO ARCGIS NA EDIÇÃO
                window.camadaItensNuvem.applyEdits({ updateFeatures: [{ attributes: atributosEdicao }] }).then((res) => {
                    if (res.updateFeatureResults && res.updateFeatureResults.length > 0 && res.updateFeatureResults[0].error) {
                        
                        // Captura o erro em todos os formatos possíveis da Esri
                        const erroDaEsri = res.updateFeatureResults[0].error;
                        const msgErro = erroDaEsri.description || erroDaEsri.message || JSON.stringify(erroDaEsri);
                        
                        alert("❌ Erro do Banco de Dados:\n" + msgErro);
                        btnSalvar.innerText = "Salvar Obra";
                        btnSalvar.disabled = false;
                        return;
                    }
                
                if (res.addFeatureResults.length > 0 && res.addFeatureResults[0].objectId) {
                    const idOficial = res.addFeatureResults[0].objectId;
                    
                    subirGaleriaInteira(idOficial).then((jsonFinal) => {
                        const attUpdate = { ...atributosEdicao };
                        attUpdate.obra_galeria = JSON.stringify(jsonFinal);
                        attUpdate.obra_imagem = jsonFinal.length > 0 ? jsonFinal[0].url : "";
                        attUpdate[window.camadaItensNuvem.objectIdField || "OBJECTID"] = idOficial;
                        
                        window.camadaItensNuvem.applyEdits({ updateFeatures: [{ attributes: attUpdate }] });
                        
                        const itemNovo = { 
                            ...atributosEdicao, 
                            praca: String(optionSelecionada.value),
                            lon: parseFloat(optionSelecionada.getAttribute('data-lon')),
                            lat: parseFloat(optionSelecionada.getAttribute('data-lat')),
                            obra_galeria: JSON.stringify(jsonFinal),
                            obra_imagem: jsonFinal.length > 0 ? jsonFinal[0].url : "", 
                            id: idOficial, 
                            objectId: idOficial,
                            geometriaOriginal: graphicNovo.geometry
                        };
                        window.bancoDeDadosItens.push(itemNovo);
                        
                        if (window.bancoDeDadosObras) {
                            window.bancoDeDadosObras.push({
                               id: idOficial, 
                               praca: optionSelecionada.value,
                               titulo: atributosEdicao.obra_titulo,
                               status: atributosEdicao.obra_status,
                               orcamento: atributosEdicao.obra_orcamento,
                               lon: itemNovo.lon,
                               lat: itemNovo.lat
                            });
                        }
                        finalizarESair(idOficial);
                    });
                }
            }).catch(err => { console.error(err); finalizarESair(null); });
          }
        };
                    
        // Renderiza a lista na inicialização
        window.renderizarPainelObras();

        // Deletar obra do painel
        window.deletarObra = function(id) {
          if(!confirm("⚠️ Tem certeza que deseja excluir esta obra permanentemente do sistema?")) return;
          
          // Remove do banco de dados unificado na hora!
          window.bancoDeDadosItens = window.bancoDeDadosItens.filter(i => i.id !== id);
          
          // Atualiza a Interface
          window.voltarParaListaObras();
          window.renderizarPainelObras();
          if (pracaAtivaId) window.atualizarInterfaceEMapa();

          // Manda a ordem de deleção pra Nuvem 
          window.sincronizarDelecaoNuvem(id);
        };


        // --- ATUALIZAR MAPA E LISTA LATERAL DO INVENTÁRIO (CORRIGIDO E UNIFICADO) ---
        window.atualizarInterfaceEMapa = function() {
          graphicsLayer.removeAll();
          const divLista = document.getElementById('lista-itens-dinamica');
          divLista.innerHTML = '';

          // RECUPERADO: Linha vital que filtra os itens...
          let itensDaPraca = window.bancoDeDadosItens.filter(i => String(i.praca) === String(pracaAtivaId));

          // NOVO: Aplica o filtro de status no mapa 3D (Os itens ocultos sequer serão desenhados)
          if (window.filtroStatusAtivo !== 'Todos') {
              itensDaPraca = itensDaPraca.filter(i => i.status === window.filtroStatusAtivo);
          }
          // Puxa os dados oficiais de inventário do arquivo GEOJSON
          const pracaGeo = window.todasAsPracas.find(p => p.idOficial === pracaAtivaId);

         // --- FILTRO NATIVO: ESCONDE AS OUTRAS PRAÇAS ---
          if (pracaGeo && pracaGeo.geometriaPoligono) {
            view.whenLayerView(pracasLayer).then(function(layerView) {
              // Mantém APENAS a praça que foi clicada visível
              layerView.filter = {
                geometry: pracaGeo.geometriaPoligono,
                spatialRelationship: "intersects"
              };
            });
          }

         // 1. Obras na Aba Geral removidas para simplificar a interface
          const divStatusObra = document.getElementById('status-obra-praca');
          if (divStatusObra) {
              divStatusObra.innerHTML = ''; 
          }

          // 2. Injetar Inventário SMAMUS na Aba de Gestão
          const divSmamus = document.getElementById('inventario-smamus-container');
          let smamusHTML = '';
          
          if (pracaGeo) {
            const temDado = (valor) => valor && valor.toString().trim() !== "" && valor.toString().trim() !== "0" && valor.toString().trim() !== "Não informado";
            
            if (temDado(pracaGeo.bancos) || temDado(pracaGeo.lixeiras) || temDado(pracaGeo.iluminacao) || temDado(pracaGeo.ambientes)) {
              smamusHTML = `
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm mb-6">
                  <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <h4 class="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                      Inventário SMAMUS
                    </h4>
                    <button onclick="autoGerarMobiliario('${pracaGeo.idOficial}')" class="bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-black px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 uppercase tracking-wider">
                      Gerar 3D
                    </button>
                  </div>
                  
                  <div class="grid grid-cols-2 gap-y-4 gap-x-4 text-sm">
                    ${temDado(pracaGeo.bancos) ? `<div class="flex flex-col gap-0.5"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Bancos</span><strong class="text-slate-700">${pracaGeo.bancos}</strong></div>` : ''}
                    ${temDado(pracaGeo.lixeiras) ? `<div class="flex flex-col gap-0.5"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Lixeiras</span><strong class="text-slate-700">${pracaGeo.lixeiras}</strong></div>` : ''}
                    ${temDado(pracaGeo.iluminacao) ? `<div class="flex flex-col gap-0.5"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Iluminação</span><strong class="text-slate-700">${pracaGeo.iluminacao}</strong></div>` : ''}
                    ${temDado(pracaGeo.bebedouros) ? `<div class="flex flex-col gap-0.5"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Bebedouros</span><strong class="text-slate-700">${pracaGeo.bebedouros}</strong></div>` : ''}
                    
                    ${temDado(pracaGeo.elementos) ? `<div class="col-span-2 pt-3 border-t border-slate-50"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Elementos Base</span><span class="font-medium text-slate-600 text-xs leading-relaxed">${pracaGeo.elementos}</span></div>` : ''}
                    ${temDado(pracaGeo.monumentos) ? `<div class="col-span-2 pt-3 border-t border-slate-50"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Monumentos</span><span class="font-medium text-slate-600 text-xs leading-relaxed">${pracaGeo.monumentos}</span></div>` : ''}
                  </div>
                </div>
              `;
            }
          }
          if(divSmamus) divSmamus.innerHTML = smamusHTML;

          // LOOP: Desenha os GLBs e cria os Cards
          itensDaPraca.forEach(item => {
            
            // 🔴 NOVA MÁGICA: Se a obra estiver concluída, sai daqui e não desenha NADA!
            if (item.arquivo_glb && item.arquivo_glb.includes("obra_em_andamento") && item.obra_status === "Concluído") {
                return; 
            }

            // 🟢 MÁGICA DA FLORESTA LEVE: Lê 1 item e projeta os clones visuais no mapa!
            if (item.arquivo_glb === "area_floresta_tree" && item.obra_desc) {
                try {
                    let aneis, wkidPoligono;
                    
                    // Lógica para ler o novo formato comprimido ou o formato antigo em JSON
                    if (item.obra_desc.startsWith("{")) {
                        const dadosObj = JSON.parse(item.obra_desc);
                        aneis = dadosObj.r ? dadosObj.r : dadosObj;
                        wkidPoligono = dadosObj.w ? dadosObj.w : 4326;
                    } else {
                        const partes = item.obra_desc.split(';');
                        wkidPoligono = parseInt(partes[0]);
                        const cx = parseFloat(partes[1]);
                        const cy = parseFloat(partes[2]);
                        const pts = partes[3].split('_').map(d => {
                            const coords = d.split(',');
                            // 🔴 Alterado para dividir por 10000
                            return [cx + (parseInt(coords[0]) / 10000), cy + (parseInt(coords[1]) / 10000)];
                        });
                        aneis = [pts];
                    }

                    if (!aneis || !aneis[0] || aneis[0].length === 0) return;

                    const polyGraphic = new Graphic({
                        geometry: { type: "polygon", rings: aneis, spatialReference: { wkid: wkidPoligono } }
                    });
                    const polyEsri = polyGraphic.geometry;

                    const pacoteDeGraficos = [];

                    // Tapete verde base
                    pacoteDeGraficos.push(new Graphic({
                        geometry: polyEsri,
                        attributes: { idVisual: item.id, nome: item.nome, status: item.status, tipo: "modelo" },
                        symbol: {
                            type: "polygon-3d",
                            symbolLayers: [{
                                type: "fill",
                                material: { color: [34, 197, 94, 0.2] }, 
                                outline: { color: [21, 128, 61, 0.5], size: 1 }
                            }]
                        }
                    }));

                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    aneis[0].forEach(pt => {
                        if (pt[0] < minX) minX = pt[0];
                        if (pt[0] > maxX) maxX = pt[0];
                        if (pt[1] < minY) minY = pt[1];
                        if (pt[1] > maxY) maxY = pt[1];
                    });

                    let areaMetros = 1000;
                    try { areaMetros = Math.abs(geometryEngine.geodesicArea(polyEsri, "square-meters")); } catch(e) {}

                    // 🔴 O TRIPLO DE ÁRVORES: 1 árvore a cada 25m², máximo de 150 árvores.
                    let limiteArvores = Math.ceil(areaMetros / 25);
                    if (limiteArvores < 5) limiteArvores = 5;
                    if (limiteArvores > 150) limiteArvores = 150; 

                    let fatorCobertura = Math.sqrt(areaMetros / limiteArvores) / 4.0; 
                    if (fatorCobertura < 1.0) fatorCobertura = 1.0;
                    if (fatorCobertura > 3.5) fatorCobertura = 3.5; 

                    const limiteTentativas = limiteArvores * 5;

                    const pontoDentroDoPoligono = (px, py, ring) => {
                        let inside = false;
                        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                            let xi = ring[i][0], yi = ring[i][1];
                            let xj = ring[j][0], yj = ring[j][1];
                            let intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
                            if (intersect) inside = !inside;
                        }
                        return inside;
                    };

                    let contadorArvores = 0;
                    let tentativas = 0;
                    
                    while (contadorArvores < limiteArvores && tentativas < limiteTentativas) {
                        tentativas++;
                        const xAleatorio = minX + Math.random() * (maxX - minX);
                        const yAleatorio = minY + Math.random() * (maxY - minY);
                        
                        if (pontoDentroDoPoligono(xAleatorio, yAleatorio, aneis[0])) {
                            contadorArvores++;
                            const variacaoEscala = fatorCobertura + (Math.random() * 0.5 * fatorCobertura);
                            const variacaoGiro = Math.floor(Math.random() * 360);

                            pacoteDeGraficos.push(new Graphic({
                                geometry: { type: "point", x: xAleatorio, y: yAleatorio, spatialReference: { wkid: wkidPoligono } },
                                attributes: { tipo: "clone_visual_fantasma" }, 
                                symbol: criarSimboloGLB("leaf_tree_-_ps1_low_poly.glb", item.escala * variacaoEscala, item.rotacao + variacaoGiro, 0, 0, item.status)
                            }));
                        }
                    }
                    
                    // Renderiza as 150 árvores juntas em um único respiro da placa de vídeo
                    graphicsLayer.addMany(pacoteDeGraficos);
                    return; 
                } catch(e) { console.error("Erro ao projetar bosque:", e); }
            }

            // 1. Desenha o seu Modelo GLB Oficial
            let geoItem;
            if (item.geometriaOriginal && typeof item.geometriaOriginal.clone === 'function') {
              geoItem = item.geometriaOriginal.clone();
            } else {
              geoItem = { type: "point", longitude: item.lon, latitude: item.lat, spatialReference: { wkid: 4326 } };
            }
            geoItem.z = item.altitude || 0;

            const modeloGrafico = new Graphic({
              geometry: geoItem, 
              attributes: { idVisual: item.id, nome: item.nome, status: item.status, escala: item.escala || 1, tipo: "modelo" },
              symbol: criarSimboloGLB(item.arquivo_glb || 'obra_em_andamento.glb', item.escala || 1, item.rotacao || 0, item.inclinacao || 0, item.rolagem || 0, item.status)
            });
            graphicsLayer.add(modeloGrafico);

            // 2. O PINO VERMELHO DE CONSERTO (Mobiliário Quebrado)
            if (item.status === "Necessita Conserto") {
              const geoIndicador = geoItem.clone();
              const indicadorGrafico = new Graphic({
                geometry: geoIndicador,
                attributes: { idVisual: item.id, tipo: "indicador" },
                symbol: {
                  type: "point-3d",
                  verticalOffset: { screenLength: 50, maxWorldLength: 100, minWorldLength: 1 },
                  callout: { type: "line", size: 1.5, color: [239, 68, 68], border: { color: [255, 255, 255] } },
                  symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, material: { color: [239, 68, 68] }, outline: { color: "white", size: 0.4 }, size: 12 }]
                }
              });
              graphicsLayer.add(indicadorGrafico);
            }

            // 3. A MÁGICA PARA OBRAS: PINO AZUL OU LARANJA
            if (item.arquivo_glb && item.arquivo_glb.includes("obra_em_andamento")) {
              let corPino = [245, 158, 11]; // Laranja (Em Execução) padrão
              if (item.obra_status === "Planejado") corPino = [59, 130, 246]; // Azul
              
              const geoIndicadorObra = typeof geoItem.clone === 'function' ? geoItem.clone() : { ...geoItem };

              const indicadorObraGrafico = new Graphic({
                geometry: geoIndicadorObra,
                attributes: { idVisual: item.id, tipo: "indicador" },
                symbol: {
                  type: "point-3d",
                  verticalOffset: { screenLength: 60, maxWorldLength: 100, minWorldLength: 1 },
                  callout: { type: "line", size: 1.5, color: corPino, border: { color: [255, 255, 255] } },
                  symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, material: { color: corPino }, outline: { color: "white", size: 0.4 }, size: 14 }]
                }
              });
              graphicsLayer.add(indicadorObraGrafico);
            }
          });
          // DELEGAR: Agora chamamos a nova função que cuida APENAS do menu de HTML com as sanfonas
          const termoPesquisaSalvo = document.getElementById('input-pesquisa-itens') ? document.getElementById('input-pesquisa-itens').value : "";
          window.renderizarHTMLInventario(termoPesquisaSalvo);

          // Esconde os objetos que estiverem com o "Olho" fechado na sanfona
          graphicsLayer.graphics.forEach(g => {
              if (g.attributes && g.attributes.idVisual) {
                  const item = window.bancoDeDadosItens.find(i => i.id === g.attributes.idVisual);
                  if (item && window.visibilidadeGrupos[window.obterNomeGaveta(item.arquivo_glb)] === false) {
                      g.visible = false;
                  }
              } else if (g.attributes && g.attributes.tipo === "clone_visual_fantasma") {
                  if (window.visibilidadeGrupos["Árvores e Vegetação"] === false) {
                      g.visible = false;
                  }
              }
          });

        };

        // --- NOVAS FUNÇÕES UNIFICADAS DE MANIPULAÇÃO 3D ---
        window.toggleMenu3D = function(id) {
          idMenu3DAberto = (idMenu3DAberto === id) ? null : id;
          
          // 1. Salva a posição exata da barra de rolagem do painel principal
          const painelConteudo = document.querySelector('.flex-1.overflow-y-auto');
          const scrollSalvo = painelConteudo ? painelConteudo.scrollTop : 0;
          
          // 2. Salva a rolagem das sanfonas internas (caso a lista seja muito longa)
          const sanfonas = document.querySelectorAll('.max-h-\\[40vh\\]');
          const scrollSanfonas = Array.from(sanfonas).map(s => s.scrollTop);

          // 3. Atualiza APENAS o HTML da lista, sem tocar no Mapa 3D!
          const termoPesquisaSalvo = document.getElementById('input-pesquisa-itens') ? document.getElementById('input-pesquisa-itens').value : "";
          window.renderizarHTMLInventario(termoPesquisaSalvo);

          // 4. Devolve as barras de rolagem exatamente para onde estavam
          const novoPainel = document.querySelector('.flex-1.overflow-y-auto');
          if (novoPainel) novoPainel.scrollTop = scrollSalvo;
          
          const novasSanfonas = document.querySelectorAll('.max-h-\\[40vh\\]');
          novasSanfonas.forEach((s, i) => {
              if (scrollSanfonas[i]) s.scrollTop = scrollSanfonas[i];
          });
        };

        // --- NOVO MOTOR DE AJUSTE CONTÍNUO (SLIDERS + INPUTS) ---
        window.aplicarAjuste3D = function(id, propriedade, valor, salvarNaNuvem) {
          const item = window.bancoDeDadosItens.find(i => i.id === id);
          if (item) {
            const numVal = parseFloat(valor);
            item[propriedade] = numVal;
            
            // Suporte para o novo formato de input numérico de digitação
            const inputNum = document.getElementById(`input-${propriedade}-${id}`);
            if(inputNum && document.activeElement !== inputNum) {
                 if(propriedade === 'escala') inputNum.value = numVal.toFixed(2);
                 else if(propriedade === 'altitude') inputNum.value = numVal.toFixed(1);
                 else inputNum.value = numVal;
            }
            
            // Suporte para o slider arrastável
            const sliderNum = document.getElementById(`slider-${propriedade}-${id}`);
            if(sliderNum && document.activeElement !== sliderNum) {
                 sliderNum.value = numVal;
            }

            // Atualiza o Modelo 3D no mapa Imediatamente
            const grafico = graphicsLayer.graphics.find(g => g.attributes && g.attributes.idVisual === id && g.attributes.tipo === "modelo");
            if (grafico) {
               grafico.symbol = criarSimboloGLB(item.arquivo_glb, item.escala, item.rotacao, item.inclinacao || 0, item.rolagem || 0, item.status);
               if (propriedade === 'altitude') {
                   const novaGeometria = grafico.geometry.clone();
                   novaGeometria.z = numVal;
                   grafico.geometry = novaGeometria;
               }
            }

            // 3. Atualiza a Seta (Callout) ao vivo
            const indicador = graphicsLayer.graphics.find(g => g.attributes && g.attributes.idVisual === id && g.attributes.tipo === "indicador");
            if (indicador) {
               if (propriedade === 'altitude') {
                   const novaGeoIndicador = indicador.geometry.clone();
                   novaGeoIndicador.z = numVal; 
                   indicador.geometry = novaGeoIndicador;
               }
            }

            // 4. A MÁGICA: Salva silenciosamente SEM chamar atualizarInterfaceEMapa()
            if (salvarNaNuvem) {
              window.sincronizarAtualizacaoNuvem(item);
              // Não recarregamos o HTML, então a barra de rolagem fica congelada no lugar exato!
            }
          }
        };

        // --- AÇÕES DE EDIÇÃO (CRUD) ---
        window.deletarItem = function(id) {
          const item = window.bancoDeDadosItens.find(i => i.id === id);
          if (item) window.sincronizarDelecaoNuvem(item.objectId); // <--- MANDA DELETAR NA NUVEM
          
          window.bancoDeDadosItens = window.bancoDeDadosItens.filter(i => i.id !== id);
          atualizarInterfaceEMapa();
        };

        window.mudarStatus = function(id) {
          const item = window.bancoDeDadosItens.find(i => i.id === id);
          if (item) {
            item.status = item.status === "OK" ? "Necessita Conserto" : "OK";
            window.sincronizarAtualizacaoNuvem(item); // <--- MANDA PRA NUVEM
            atualizarInterfaceEMapa();
          }
        };

        window.editarNomeItem = function(id) {
          const item = window.bancoDeDadosItens.find(i => i.id === id);
          if (item) {
            const novoNome = prompt("Digite o novo nome para o mobiliário:", item.nome);
            if (novoNome && novoNome.trim() !== "") {
              item.nome = novoNome;
              window.sincronizarAtualizacaoNuvem(item); 
              
              // Atualiza só o textozinho no mapa 3D e no HTML específico, sem apagar tudo
              const grafico = graphicsLayer.graphics.find(g => g.attributes && g.attributes.idVisual === id && g.attributes.tipo === "modelo");
              if (grafico) grafico.attributes.nome = novoNome;
              
              // Recarrega o HTML da lista guardando a posição do Scroll
              const divInventario = document.querySelector('#aba-geral .overflow-y-auto') || document.getElementById('lista-itens-dinamica');
              const scrollSalvo = divInventario ? divInventario.scrollTop : 0;
              
              const termoPesquisaSalvo = document.getElementById('input-pesquisa-itens') ? document.getElementById('input-pesquisa-itens').value : "";
              window.renderizarHTMLInventario(termoPesquisaSalvo);
              
              if (divInventario) divInventario.scrollTop = scrollSalvo;
            }
          }
        };

        // =====================================================================
        // 🔴 MOTOR DE ÁREA DE FLORESTA (1 Registro, Múltiplas Árvores Visuais)
        // =====================================================================
        
        const camadaDesenho = new GraphicsLayer({ elevationInfo: { mode: "on-the-ground" } });
        map.add(camadaDesenho);

        const sketch = new SketchViewModel({
            view: view,
            layer: camadaDesenho,
            polygonSymbol: {
                type: "simple-fill",
                color: [34, 197, 94, 0.4], 
                outline: { color: [34, 197, 94, 1], width: 2, style: "dash" }
            }
        });

        sketch.on("create", function(event) {
            if (event.state === "complete") {
                const poligono = event.graphic.geometry;
                camadaDesenho.removeAll(); 
                document.getElementById('msg-instrucao').classList.add('hidden'); 

                if (!pracaAtivaId) {
                    alert("⚠️ Abra a gestão de uma praça primeiro para vincular a floresta a ela!");
                    return;
                }

                const centro = poligono.centroid;
                const srWkid = poligono.spatialReference.wkid; 

                // 1. Limita o desenho a no máximo 10 pontas (Garante que nunca chegue perto de 255 chars)
                let anelOriginal = poligono.rings[0];
                if (anelOriginal.length > 10) {
                    const passo = Math.ceil(anelOriginal.length / 10);
                    anelOriginal = anelOriginal.filter((_, idx) => idx % passo === 0);
                    anelOriginal.push(anelOriginal[0]); 
                }
                
                // 2. A MÁGICA DA COMPRESSÃO: Converte as coordenadas com precisão de 10000
                const cx = parseFloat(centro.longitude.toFixed(5));
                const cy = parseFloat(centro.latitude.toFixed(5));
                const deltas = anelOriginal.map(pt => {
                    const dx = Math.round((pt[0] - cx) * 10000); // 🔴 Alterado para 10000
                    const dy = Math.round((pt[1] - cy) * 10000); // 🔴 Alterado para 10000
                    return `${dx},${dy}`;
                }).join('_');
                
                // Texto ultra comprimido e seguro contra o limite de 255 caracteres do ArcGIS
                const desenhoComprimido = `${srWkid};${cx};${cy};${deltas}`;

                const geometriaPonto = { type: "point", longitude: centro.longitude, latitude: centro.latitude, spatialReference: { wkid: 4326 } };

                const novoItem = {
                    id: Date.now(),
                    praca: pracaAtivaId,
                    nome: "Área de Floresta",
                    arquivo_glb: "area_floresta_tree", 
                    status: "OK",
                    lon: centro.longitude,
                    lat: centro.latitude,
                    escala: 1,
                    rotacao: 0,
                    altitude: 0,
                    obra_desc: desenhoComprimido,
                    geometriaOriginal: geometriaPonto
                };

                const graficoNuvem = new Graphic({
                    geometry: geometriaPonto,
                    attributes: {
                        praca_id: novoItem.praca,
                        nome: novoItem.nome,
                        arquivo_glb: novoItem.arquivo_glb,
                        status: novoItem.status,
                        escala: novoItem.escala,
                        rotacao: novoItem.rotacao,
                        altitude: 0,
                        obra_desc: novoItem.obra_desc 
                    }
                });

                window.camadaItensNuvem.applyEdits({ addFeatures: [graficoNuvem] }).then(function(resultado) {
                    const sucesso = resultado.addFeatureResults;
                    if (sucesso.length > 0 && sucesso[0].objectId) {
                        novoItem.objectId = sucesso[0].objectId;
                        novoItem.id = sucesso[0].objectId; 
                    }
                    window.bancoDeDadosItens.push(novoItem);
                    window.atualizarInterfaceEMapa();
                    alert("✅ Área mapeada com sucesso!");
                }).catch(err => console.error("Erro ao salvar floresta:", err));
            }
        });

        window.ativarFerramentaFloresta = function() {
            if (!pracaAtivaId) {
                alert("⚠️ Selecione uma praça na lista antes de plantar!");
                return;
            }
            document.getElementById('msg-instrucao').innerText = "📍 Desenhe o perímetro da floresta (clique duplo finaliza).";
            document.getElementById('msg-instrucao').classList.remove('hidden');
            sketch.create("polygon"); 
        };


        window.galeriaTemp = [];
window.arquivosPC = {};



window.adicionarFotoGaleriaPC = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const fileId = 'pc_' + Date.now();
        window.arquivosPC[fileId] = { file: file, preview: e.target.result };
        window.galeriaTemp.push({ url: "", desc: "", fileId: fileId });
        window.renderizarGaleriaModal();
    };
    reader.readAsDataURL(file);
};

window.adicionarFotoGaleriaURL = function() {
    const url = prompt("Cole o link (URL) da imagem:");
    if (url && url.trim() !== "") {
        window.galeriaTemp.push({ url: url.trim(), desc: "" });
        window.renderizarGaleriaModal();
    }
};

window.removerFotoGaleria = function(index) {
    if (window.galeriaTemp[index].fileId) delete window.arquivosPC[window.galeriaTemp[index].fileId];
    window.galeriaTemp.splice(index, 1);
    window.renderizarGaleriaModal();
};

// =====================================================================
        // MOTOR DE GALERIA DE FOTOS (USANDO O CAMPO NOVO OBRA_GALERIA)
        // =====================================================================
        
        window.obterGaleriaCompleta = function(item) {
            if (!item) return [];
            let str = item.obra_galeria || item.obra_imagem || item.imagem || "";
            if (!str) return [];
            
            try {
                let parsed = JSON.parse(str);
                if (Array.isArray(parsed)) {
                    // MÁGICA: Agora lê o campo 'data' do banco
                    return parsed.map(foto => ({ url: foto.url, desc: foto.desc || "", data: foto.data || "" }));
                }
            } catch(e) {
                if (str.startsWith('http') || str.startsWith('data:')) return [{ url: str, desc: "", data: "" }];
            }
            return [];
        };

        window.obterUrlImagem = function(item) {
            const galeria = window.obterGaleriaCompleta(item);
            if (galeria.length > 0) return galeria[0].url;
            return "";
        };

        window.galeriaTemp = [];
        window.arquivosPC = {};

        window.abrirModalImagem = function(id) {
            const item = window.bancoDeDadosItens.find(i => String(i.id) === String(id) || String(i.idVisual) === String(id));
            if (!item) return;

            window.galeriaTemp = window.obterGaleriaCompleta(item);
            window.arquivosPC = {};

            const modalExistente = document.getElementById('modal-imagem-mobiliario');
            if (modalExistente) modalExistente.remove();

            document.body.insertAdjacentHTML('beforeend', `
            <div id="modal-imagem-mobiliario" class="fixed inset-0 z-[999999] bg-black/60 flex items-center justify-center backdrop-blur-sm">
              <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-green-100 flex flex-col max-h-[90vh] mx-4 relative">
                <div class="flex justify-between items-center border-b pb-3 mb-4 shrink-0">
                  <h3 class="text-base font-bold text-gray-800">Galeria: <span class="text-green-700">${item.nome}</span></h3>
                  <button onclick="document.getElementById('modal-imagem-mobiliario').remove()" class="text-gray-400 hover:text-red-500 text-2xl font-bold transition">&times;</button>
                </div>
                <div id="galeria-lista" class="flex-1 overflow-y-auto space-y-3 pr-2 mb-4"></div>
                <div class="bg-gray-50 p-3 rounded-xl border border-gray-200 shrink-0">
                    <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Adicionar Foto</span>
                    <div class="flex gap-2 mb-1">
                        <label class="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg border border-green-200 cursor-pointer transition text-xs font-bold shadow-sm">
                            Do Computador <input type="file" accept="image/*" class="hidden" onchange="window.adicionarFotoGaleriaPC(event)" />
                        </label>
                        <button onclick="window.adicionarFotoGaleriaURL()" class="flex-1 px-3 py-2 bg-white hover:bg-gray-100 text-gray-600 rounded-lg border border-gray-300 transition text-xs font-bold shadow-sm">Usar Link (URL)</button>
                    </div>
                </div>
                <div class="flex gap-3 mt-2 shrink-0">
                  <button onclick="document.getElementById('modal-imagem-mobiliario').remove()" class="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition text-sm font-bold">Cancelar</button>
                  <button onclick="window.salvarGaleriaMobiliario('${id}')" id="btn-salvar-galeria" class="flex-1 py-2.5 bg-green-700 hover:bg-green-800 text-white rounded-xl transition text-sm font-bold shadow-md">Salvar Galeria</button>
                </div>
              </div>
            </div>`);
            window.renderizarGaleriaModal();
        };

        window.renderizarGaleriaModal = function() {
            const container = document.getElementById('galeria-lista');
            if (!container) return;
            if (window.galeriaTemp.length === 0) {
                container.innerHTML = '<p class="text-xs text-gray-400 text-center italic py-4">Nenhuma foto adicionada.</p>'; return;
            }
            container.innerHTML = window.galeriaTemp.map((foto, index) => {
                const imgSrc = foto.fileId ? window.arquivosPC[foto.fileId].preview : foto.url;
                return `
                <div class="flex gap-3 bg-white p-2 rounded-xl border border-gray-200 shadow-sm items-center">
                    <img src="${imgSrc}" class="w-16 h-16 object-cover rounded-lg border border-gray-100 shrink-0">
                    <div class="flex-1 flex flex-col gap-1.5">
                        <input type="text" value="${foto.desc || ''}" onchange="window.galeriaTemp[${index}].desc = this.value" placeholder="Descrição (Ex: Banco quebrado)..." class="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-green-500">
                        <div class="flex items-center gap-1.5">
                            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Data da Foto:</span>
                            <input type="date" value="${foto.data || ''}" onchange="window.galeriaTemp[${index}].data = this.value" class="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-green-500">
                        </div>
                    </div>
                    <button onclick="window.removerFotoGaleria(${index})" class="text-gray-400 hover:text-red-500 p-2 transition font-black" title="Excluir">X</button>
                </div>`;
            }).join('');
        };

        window.adicionarFotoGaleriaPC = function(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                const fileId = 'pc_' + Date.now();
                window.arquivosPC[fileId] = { file: file, preview: e.target.result };
                window.galeriaTemp.push({ url: "", desc: "", fileId: fileId });
                window.renderizarGaleriaModal();
            };
            reader.readAsDataURL(file);
        };

        window.adicionarFotoGaleriaURL = function() {
            const url = prompt("Cole o link (URL) da imagem:");
            if (url && url.trim() !== "") {
                window.galeriaTemp.push({ url: url.trim(), desc: "" });
                window.renderizarGaleriaModal();
            }
        };

        window.removerFotoGaleria = function(index) {
            if (window.galeriaTemp[index].fileId) delete window.arquivosPC[window.galeriaTemp[index].fileId];
            window.galeriaTemp.splice(index, 1);
            window.renderizarGaleriaModal();
        };

        window.salvarGaleriaMobiliario = async function(id) {
            const item = window.bancoDeDadosItens.find(i => String(i.id) === String(id) || String(i.idVisual) === String(id));
            if (!item) return;
            const btn = document.getElementById('btn-salvar-galeria');
            btn.innerText = "A Enviar Anexos..."; btn.disabled = true;

            try {
                for (let foto of window.galeriaTemp) {
                    // Manda arquivo físico para a nuvem
                    if (foto.fileId && window.arquivosPC[foto.fileId]) {
                        const formData = new FormData();
                        formData.append("attachment", window.arquivosPC[foto.fileId].file);
                        const graphicParaAnexo = { attributes: {} };
                        graphicParaAnexo.attributes[window.camadaItensNuvem.objectIdField || "OBJECTID"] = item.objectId;
                        
                        const res = await window.camadaItensNuvem.addAttachment(graphicParaAnexo, formData);
                        if (res.error) throw new Error(res.error.description);
                        
                        const anexosResult = await window.camadaItensNuvem.queryAttachments({ objectIds: [item.objectId] });
                        const lista = anexosResult[item.objectId];
                        if (lista && lista.length > 0) foto.url = lista[lista.length - 1].url;
                        
                        delete foto.fileId;
                        delete foto.rawId;
                    }
                }
                
                const jsonLimpo = JSON.stringify(window.galeriaTemp);
                
                // Salva a lista completa no banco novo
                item.obra_galeria = jsonLimpo; 
                
                // Mantém a foto 1 como capa no banco antigo para compatibilidade
                item.obra_imagem = window.galeriaTemp.length > 0 ? window.galeriaTemp[0].url : "";
                
                window.sincronizarAtualizacaoNuvem(item);
                document.getElementById('modal-imagem-mobiliario').remove();
                
                if (typeof window.renderizarPainelObras === 'function') window.renderizarPainelObras();
                window.atualizarInterfaceEMapa();
                
            } catch (e) {
                alert("Erro: " + e.message);
                btn.innerText = "Tentar Novamente"; btn.disabled = false;
            }
        };

        // --- CATÁLOGO DOS SEUS ARQUIVOS GLB E IMAGENS ---
        const catalogoModelos = [
          { id: 'banco1', nome: 'Banco Low Poly', arquivo: 'bench_low_poly.glb', imagem: 'banco1.png' },
          { id: 'banco2', nome: 'Banco de Parque', arquivo: 'low_poly_-_park_bench.glb', imagem: 'banco2.png' },
          { id: 'arvore1', nome: 'Árvore Folhas', arquivo: 'leaf_tree_-_ps1_low_poly.glb', imagem: 'arvore1.png' },
          { id: 'arvore2', nome: 'Palmeira', arquivo: 'palm_tree.glb', imagem: 'arvore2.png' },
          { id: 'arvore3', nome: 'Pinheiro Estilizado', arquivo: 'pine_tree__low_poly_stylized_tree.glb', imagem: 'arvore3.png' },
          { id: 'arvore4', nome: 'Pinheiro PS1', arquivo: 'pine_tree_-_ps1_low_poly.glb', imagem: 'arvore4.png' },
          { id: 'poste1', nome: 'Poste Simples A', arquivo: 'simple_lamp_post_model_a.glb', imagem: 'poste1.png' },
          { id: 'poste2', nome: 'Poste de Rua', arquivo: 'street_lamp.glb', imagem: 'poste2.png' },
          { id: 'poste3', nome: 'Poste Estilizado', arquivo: 'streetlight_-_low_poly__stylized.glb', imagem: 'poste3.png' },
          { id: 'lixeira1', nome: 'Lixeira de Rua', arquivo: 'trash_can__low_poly__free.glb', imagem: 'lixeira1.png' },
          { id: 'bebedouro1', nome: 'Bebedouro', arquivo: 'lowpoly_drinking_fountain.glb', imagem: 'bebedouro.png' },
          { id: 'vestiario1', nome: 'Banheiro', arquivo: 'low_poly_toilet_stall.glb', imagem: 'banheiro.png' },
          { id: 'vestiario2', nome: 'Estrutura de Banheiros', arquivo: 'banheiro_toilet.glb', imagem: 'banheiro2.png' },
          { id: 'monumento1', nome: 'Estátua', arquivo: 'statue._monument_in_alba_italy.glb', imagem: 'monumento.png' },
          { id: 'monumento2', nome: 'Monumento', arquivo: 'monumento_memorial.glb', imagem: 'monumento2.png' },
          { id: 'chess', nome: 'Mesa de jogo', arquivo: 'chess_board_on_table.glb', imagem: 'chess.png' },
          { id: 'chess2', nome: 'Mesa de jogo 2', arquivo: 'chess_table.glb', imagem: 'chess2.png' },
          { id: 'quadra1', nome: 'Quadra Esportiva', arquivo: 'sport_court.glb', imagem: 'quadra.png' },
          { id: 'campo1', nome: 'Campo de Futebol', arquivo: 'futbol_sahasi.glb', imagem: 'campo.png' },
          { id: 'campo2', nome: 'Campo de Futsal', arquivo: 'campo_futsal.glb', imagem: 'campo1.png' },
          { id: 'basquete', nome: 'Quadra de Basquete', arquivo: 'basketball_court.glb', imagem: 'basquete.png' },
          { id: 'tennis', nome: 'Quadra de Tênis - Saibro', arquivo: 'quadra_tenis_saibro.glb', imagem: 'tenis-saibro.png' },
          { id: 'tennis2', nome: 'Quadra de Tênis - Rápida', arquivo: 'quadra_tenis_rapida.glb', imagem: 'tenis-rapida.png' },
          { id: 'cancha1', nome: 'Cancha de Bocha Descoberta', arquivo: 'campo_bocha_descoberta.glb', imagem: 'cancha.png' },
          { id: 'cancha2', nome: 'Cancha de Bocha Coberta', arquivo: 'campo_bocha_coberta.glb', imagem: 'cancha1.png' },
          { id: 'volei', nome: 'Vôlei', arquivo: 'quadra_volei.glb', imagem: 'volei.png' },
          { id: 'beachTenis', nome: 'Beach Tennis', arquivo: 'quadra_beach_tennis.glb', imagem: 'beach.png' },
          { id: 'skate1', nome: 'Pista de Skate', arquivo: 'halfpipe_skatepark_ramp_-_low_poly_baked.glb', imagem: 'skate.png' },
          { id: 'play1', nome: 'Playground Infantil', arquivo: 'playground.glb', imagem: 'playground.png' },
          { id: 'play2', nome: 'Gangorra', arquivo: 'seesaw.glb', imagem: 'playground2.png' },
          { id: 'play3', nome: 'Escorregador', arquivo: 'slide_game-asset_under_2.5k_triangles_and_uvs.glb', imagem: 'playground3.png' },
          { id: 'academia', nome: 'Academia ao Ar Livre', arquivo: 'simple_low_poly_calisthenics.glb', imagem: 'academia_ar_livre.jpg' },
          { id: 'academia1', nome: 'Academia', arquivo: 'academia_ar_livre.glb', imagem: 'academia_ar_livre.jpg' },
          { id: 'ginastica1', nome: 'Aparelhos de Ginástica', arquivo: 'gym_equipment_2.glb', imagem: 'ginastica.png' },
          { id: 'churrasqueira1', nome: 'Churrasqueira', arquivo: 'barbecue.glb', imagem: 'churrasqueira.png' },
          { id: 'estar1', nome: 'Área de Estar/Pergolado', arquivo: 'pergola_low_poly.glb', imagem: 'pergolado.png' }
        ];

        let modeloEscolhidoUrl = null;

        // --- NOVO SISTEMA DE INVENTÁRIO AGRUPADO (SANFONAS) ---
        window.estadoSanfonas = {}; // Guarda quais grupos estão abertos/fechados

        window.renderizarHTMLInventario = function(termoPesquisa = "") {
          const divLista = document.getElementById('lista-itens-dinamica');
          divLista.innerHTML = '';
          
          let itens = window.bancoDeDadosItens.filter(i => String(i.praca) === String(pracaAtivaId));

          itens = itens.filter(i => {
              if (i.arquivo_glb && i.arquivo_glb.includes("obra_em_andamento") && i.obra_status === "Concluído") return false;
              return true; 
          });

          if (window.filtroStatusAtivo !== 'Todos') {
              itens = itens.filter(i => i.status === window.filtroStatusAtivo);
          }
          
          if(termoPesquisa.trim() !== "") {
              const termo = window.removerAcentos(termoPesquisa);
              itens = itens.filter(i => 
                  window.removerAcentos(i.nome).includes(termo) || 
                  window.removerAcentos(i.status).includes(termo)
              );
          }

          const grupos = {};
          itens.forEach(item => {
              const nomeGrupo = window.obterNomeGaveta(item.arquivo_glb);
              if(!grupos[nomeGrupo]) grupos[nomeGrupo] = [];
              grupos[nomeGrupo].push(item);
          });

          for(const [nomeGrupo, itensGrupo] of Object.entries(grupos)) {
              const isAberto = termoPesquisa.trim() !== "" ? true : !!window.estadoSanfonas[nomeGrupo];
              const iconeSeta = isAberto ? '▼' : '▶';
              const displayClasses = isAberto ? 'block' : 'hidden';

              // Lógica do Olho: Corrigido o bug do tamanho invisível (agora w-5 h-5)
              // Verde escuro (ativo) e Cinza (inativo)
              const isVisivel = window.visibilidadeGrupos[nomeGrupo] !== false;
              const corOlho = isVisivel ? "text-emerald-800 hover:text-emerald-950 hover:scale-110" : "text-slate-400 hover:text-slate-600 hover:scale-110";
              const svgOlho = isVisivel 
                  ? `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>`
                  : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>`;

              // MÁGICA DO CABEÇALHO: Fundo translúcido, Nome limpo na esquerda, Controles e Número na direita
              let htmlGrupo = `
              <div class="mb-4 border border-emerald-200/70 rounded-[20px] bg-white overflow-hidden shadow-[0_4px_15px_-4px_rgba(0,0,0,0.03)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(16,185,129,0.1)] hover:border-emerald-300/80">
                <div class="w-full flex justify-between items-center bg-gradient-to-r from-[#15803d]/25 via-emerald-700/15 to-green-900/20 backdrop-blur-sm border-b border-emerald-100/50 transition hover:bg-emerald-500/10">
                   
                   <!-- LADO ESQUERDO: Apenas o Nome -->
                   <div onclick="window.toggleGrupoInventario('${nomeGrupo}')" class="flex-1 flex items-center p-4 cursor-pointer outline-none select-none">
                     <span class="font-extrabold text-[14px] text-emerald-900 tracking-wide transition-colors hover:text-emerald-700">
                       ${nomeGrupo} 
                     </span>
                   </div>
                   
                   <!-- LADO DIREITO: Número, Olho e Seta -->
                   <div class="flex items-center pr-4 shrink-0 gap-1.5">
                       
                       <span class="bg-emerald-600 text-white text-[10px] px-2.5 py-0.5 rounded-full shadow-sm font-bold mr-1">
                           ${itensGrupo.length}
                       </span>

                       <button onclick="window.toggleVisibilidadeGrupo('${nomeGrupo}', event)" class="p-1.5 transition-all duration-200 ${corOlho} outline-none drop-shadow-sm" title="Mostrar/Ocultar no Mapa 3D">
                           ${svgOlho}
                       </button>
                       
                       <span onclick="window.toggleGrupoInventario('${nomeGrupo}')" class="text-[10px] text-emerald-800/40 hover:text-emerald-800 font-black cursor-pointer p-1.5 flex items-center justify-center select-none transition-colors">
                           ${iconeSeta}
                       </span>
                   </div>
                   
                </div>
                <div class="${displayClasses} p-4 bg-slate-50/40 space-y-2 max-h-[45vh] overflow-y-auto">
              `;

              itensGrupo.forEach(item => {
                  const isOK = item.status === 'OK';
                  
                  // Gradiente do interior do card que já estava aprovado
                  const bgCard = isOK ? 'from-[#15803d]/30 via-emerald-800/15 to-green-950/20' : 'from-[#991b1b]/30 via-red-800/15 to-rose-950/20';
                  const hoverBorder = isOK ? 'hover:border-emerald-300' : 'hover:border-red-300';
                  
                  const ledPulse = isOK ? 'bg-emerald-400' : 'bg-red-500';
                  const ledDot = isOK ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]';
                  
                  const hoverTitleColor = isOK ? 'group-hover:text-emerald-700' : 'group-hover:text-red-700';

                  htmlGrupo += `
                  <div id="card-item-${item.id}" class="relative mb-4 rounded-[20px] bg-gradient-to-r ${bgCard} border border-slate-200/60 shadow-[0_4px_15px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_15px_35px_-5px_rgba(0,0,0,0.12)] hover:-translate-y-1 transition-all duration-400 group overflow-hidden ${hoverBorder}">

                      <div class="p-4.5 p-4 relative z-10">
                          <!-- Cabeçalho: Nome e Ferramentas -->
                          <div class="flex justify-between items-start gap-4">
                              
                              <div class="flex-1 flex flex-col cursor-pointer overflow-hidden" onclick="window.focarObjetoNoMapa(${item.id})" title="Focar no mapa">
                                  <h4 class="font-black text-[15px] text-slate-800 leading-tight ${hoverTitleColor} transition-colors truncate w-full pr-2">${item.nome}</h4>
                                  <span class="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-1.5 flex items-center gap-1.5 ${hoverTitleColor} transition-colors">
                                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                      Focar Câmera
                                  </span>
                              </div>

                              <div class="flex items-center gap-0.5 bg-white/80 backdrop-blur-sm p-1 rounded-xl border border-slate-200/80 shrink-0 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]">
                                  
                                  <!-- Botão 1: Renomear -->
                                  <button onclick="editarNomeItem(${item.id})" class="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Renomear">
                                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </button>
                                  
                                  <!-- Botão 2: Adicionar/Editar Fotos (ÍCONE DE CÂMERA) -->
                                  <button onclick="window.abrirModalImagem('${item.id}')" class="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" title="Adicionar ou Editar Fotos">
                                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                  </button>
                                  
                                  <!-- Botão 3: Ver Galeria (ÍCONE DE FOTOS/PAISAGEM) -->
                                  <button onclick="window.abrirVisualizadorFotos('${item.id}')" class="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all" title="Ver Galeria de Fotos">
                                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                  </button>

                                  <!-- Botão 4: Excluir -->
                                  <button onclick="deletarItem(${item.id})" class="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Excluir">
                                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>

                              </div>
                          </div>

                          <div class="h-px w-full bg-gradient-to-r from-transparent via-slate-300/70 to-transparent my-3.5"></div>

                          <!-- Rodapé: Status e Ações -->
                          <div class="flex flex-wrap items-center justify-between gap-2">
                              
                              <button onclick="mudarStatus(${item.id})" class="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/80 bg-white/70 backdrop-blur shadow-sm hover:shadow hover:bg-white transition-all group/status" title="Mudar Condição">
                                  <span class="relative flex h-2 w-2">
                                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${ledPulse} opacity-60"></span>
                                      <span class="relative inline-flex rounded-full h-2 w-2 ${ledDot}"></span>
                                  </span>
                                  <span class="text-[9.5px] font-black uppercase tracking-widest text-slate-700 group-hover/status:text-slate-900">${item.status} <span class="text-slate-400 font-normal ml-0.5">↻</span></span>
                              </button>

                              <div class="flex gap-2">
                                  <button onclick="ativarModoMover(${item.id})" class="flex items-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-xl bg-white/80 text-slate-700 border border-slate-200/80 hover:border-blue-400 hover:text-blue-700 transition-all shadow-sm">
                                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                      Mover
                                  </button>
                                  <button onclick="toggleMenu3D(${item.id})" class="flex items-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-xl transition-all border shadow-sm ${idMenu3DAberto === item.id ? 'bg-slate-800 text-white border-slate-800 shadow-md shadow-slate-900/20' : 'bg-white/80 text-slate-700 border-slate-200/80 hover:border-slate-400 hover:text-slate-900'}">
                                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
                                      Ajustes
                                  </button>
                              </div>
                          </div>

                          <!-- Menu Expandível de Ajustes 3D -->
                          <div class="${idMenu3DAberto === item.id ? 'block' : 'hidden'} mt-4 pt-4 border-t border-slate-300/50 space-y-4 animate-fade-in bg-white/60 backdrop-blur-md p-4 rounded-[16px] border border-white shadow-inner">
                               
                               <div class="flex flex-col gap-2">
                                  <div class="flex justify-between items-center">
                                    <span class="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tamanho</span>
                                    <div class="flex items-center gap-1 bg-white px-1.5 py-1 rounded-md border border-slate-300 shadow-sm focus-within:border-emerald-500 transition-colors">
                                        <input type="number" min="0.1" max="5" step="0.05" id="input-escala-${item.id}" value="${(item.escala || 1).toFixed(2)}" onchange="document.getElementById('slider-escala-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'escala', this.value, true)" class="w-12 bg-transparent text-[11px] text-slate-800 font-bold font-mono outline-none text-center">
                                        <span class="text-[10px] text-slate-500 font-bold pr-1">x</span>
                                    </div>
                                  </div>
                                  <input type="range" id="slider-escala-${item.id}" min="0.1" max="5" step="0.05" value="${item.escala || 1}" oninput="document.getElementById('input-escala-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'escala', this.value, false)" onchange="aplicarAjuste3D(${item.id}, 'escala', this.value, true)" class="w-full h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-700 transition-all">
                               </div>
                               
                               <div class="flex flex-col gap-2">
                                  <div class="flex justify-between items-center">
                                    <span class="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Giro Horizontal</span>
                                    <div class="flex items-center gap-1 bg-white px-1.5 py-1 rounded-md border border-slate-300 shadow-sm focus-within:border-emerald-500 transition-colors">
                                        <input type="number" min="0" max="360" step="1" id="input-rotacao-${item.id}" value="${item.rotacao || 0}" onchange="document.getElementById('slider-rotacao-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'rotacao', this.value, true)" class="w-12 bg-transparent text-[11px] text-slate-800 font-bold font-mono outline-none text-center">
                                        <span class="text-[10px] text-slate-500 font-bold pr-1">°</span>
                                    </div>
                                  </div>
                                  <input type="range" id="slider-rotacao-${item.id}" min="0" max="360" step="1" value="${item.rotacao || 0}" oninput="document.getElementById('input-rotacao-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'rotacao', this.value, false)" onchange="aplicarAjuste3D(${item.id}, 'rotacao', this.value, true)" class="w-full h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-700 transition-all">
                               </div>
                               
                               <div class="flex flex-col gap-2">
                                  <div class="flex justify-between items-center">
                                    <span class="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Inclinação Frontal</span>
                                    <div class="flex items-center gap-1 bg-white px-1.5 py-1 rounded-md border border-slate-300 shadow-sm focus-within:border-emerald-500 transition-colors">
                                        <input type="number" min="-90" max="90" step="1" id="input-inclinacao-${item.id}" value="${item.inclinacao || 0}" onchange="document.getElementById('slider-inclinacao-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'inclinacao', this.value, true)" class="w-12 bg-transparent text-[11px] text-slate-800 font-bold font-mono outline-none text-center">
                                        <span class="text-[10px] text-slate-500 font-bold pr-1">°</span>
                                    </div>
                                  </div>
                                  <input type="range" id="slider-inclinacao-${item.id}" min="-90" max="90" step="1" value="${item.inclinacao || 0}" oninput="document.getElementById('input-inclinacao-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'inclinacao', this.value, false)" onchange="aplicarAjuste3D(${item.id}, 'inclinacao', this.value, true)" class="w-full h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-700 transition-all">
                               </div>
                               
                               <div class="flex flex-col gap-2">
                                  <div class="flex justify-between items-center">
                                    <span class="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tombar Lateral</span>
                                    <div class="flex items-center gap-1 bg-white px-1.5 py-1 rounded-md border border-slate-300 shadow-sm focus-within:border-emerald-500 transition-colors">
                                        <input type="number" min="-90" max="90" step="1" id="input-rolagem-${item.id}" value="${item.rolagem || 0}" onchange="document.getElementById('slider-rolagem-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'rolagem', this.value, true)" class="w-12 bg-transparent text-[11px] text-slate-800 font-bold font-mono outline-none text-center">
                                        <span class="text-[10px] text-slate-500 font-bold pr-1">°</span>
                                    </div>
                                  </div>
                                  <input type="range" id="slider-rolagem-${item.id}" min="-90" max="90" step="1" value="${item.rolagem || 0}" oninput="document.getElementById('input-rolagem-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'rolagem', this.value, false)" onchange="aplicarAjuste3D(${item.id}, 'rolagem', this.value, true)" class="w-full h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-700 transition-all">
                               </div>
                               
                               <div class="flex flex-col gap-2">
                                  <div class="flex justify-between items-center">
                                    <span class="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Elevação (Altura)</span>
                                    <div class="flex items-center gap-1 bg-white px-1.5 py-1 rounded-md border border-slate-300 shadow-sm focus-within:border-emerald-500 transition-colors">
                                        <input type="number" min="-5" max="20" step="0.1" id="input-altitude-${item.id}" value="${(item.altitude || 0).toFixed(1)}" onchange="document.getElementById('slider-altitude-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'altitude', this.value, true)" class="w-12 bg-transparent text-[11px] text-slate-800 font-bold font-mono outline-none text-center">
                                        <span class="text-[10px] text-slate-500 font-bold pr-1">m</span>
                                    </div>
                                  </div>
                                  <input type="range" id="slider-altitude-${item.id}" min="-5" max="20" step="0.1" value="${item.altitude || 0}" oninput="document.getElementById('input-altitude-${item.id}').value = this.value; aplicarAjuste3D(${item.id}, 'altitude', this.value, false)" onchange="aplicarAjuste3D(${item.id}, 'altitude', this.value, true)" class="w-full h-1.5 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-700 transition-all">
                               </div>
                          </div>
                      </div>
                  </div>
                  `;
              });
              htmlGrupo += `</div></div>`; 
              divLista.innerHTML += htmlGrupo;
          }
        };

        window.toggleGrupoInventario = function(nomeGrupo) {
          // Inverte o status de aberto/fechado na memória
          window.estadoSanfonas[nomeGrupo] = !window.estadoSanfonas[nomeGrupo];
          // Recarrega o HTML mantendo o texto da pesquisa (se houver)
          const termoInput = document.getElementById('input-pesquisa-itens');
          window.renderizarHTMLInventario(termoInput ? termoInput.value : "");
        };

        window.filtrarItensInventario = function(termo) {
          // Como essa função só altera o HTML, o mapa 3D não vai piscar nem recarregar os modelos atoa!
          window.renderizarHTMLInventario(termo);
        };

        // --- LÓGICA DO FILTRO DE STATUS ---
        window.filtroStatusAtivo = 'Todos'; // Inicia mostrando tudo

        window.aplicarFiltroStatus = function(status) {
          window.filtroStatusAtivo = status;
          
          const btnTodos = document.getElementById('btn-filtro-todos');
          const btnOk = document.getElementById('btn-filtro-ok');
          const btnConserto = document.getElementById('btn-filtro-conserto');

          const classeInativo = "bg-slate-50 text-slate-500 border-slate-200 shadow-sm";
          btnTodos.className = `flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all border hover:bg-slate-100 ${classeInativo}`;
          btnOk.className = `flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all border hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 ${classeInativo}`;
          btnConserto.className = `flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all border hover:bg-red-50 hover:text-red-700 hover:border-red-200 ${classeInativo}`;

          if (status === 'Todos') {
            btnTodos.className = "flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all bg-slate-800 text-white shadow-md border border-slate-800";
          } else if (status === 'OK') {
            btnOk.className = "flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all bg-emerald-50 text-emerald-700 shadow-md border border-emerald-200";
          } else if (status === 'Necessita Conserto') {
            btnConserto.className = "flex-1 text-[10px] font-black py-1.5 rounded-lg transition-all bg-red-50 text-red-700 shadow-md border border-red-200";
          }
          window.atualizarInterfaceEMapa();
        };

        window.visibilidadeGrupos = {}; // Armazena { "Bancos": true, "Lixeiras": false }

        window.toggleVisibilidadeGrupo = function(nomeGrupo, event) {
            if (event) event.stopPropagation(); // Impede de abrir/fechar a sanfona ao clicar no olho
            
            // Inverte o estado (se for undefined, assume que estava visível e vira false)
            window.visibilidadeGrupos[nomeGrupo] = window.visibilidadeGrupos[nomeGrupo] === false ? true : false;
            const isVisivel = window.visibilidadeGrupos[nomeGrupo];

            // 1. Esconde/Mostra no mapa 3D instantaneamente (sem recarregar o mapa inteiro)
            graphicsLayer.graphics.forEach(g => {
                if (g.attributes && g.attributes.idVisual) {
                    const item = window.bancoDeDadosItens.find(i => i.id === g.attributes.idVisual);
                    if (item && window.obterNomeGaveta(item.arquivo_glb) === nomeGrupo) {
                        g.visible = isVisivel;
                    }
                } else if (g.attributes && g.attributes.tipo === "clone_visual_fantasma") {
                    // Trata as árvores agrupadas da floresta
                    if (nomeGrupo === "Árvores e Vegetação") g.visible = isVisivel;
                }
            });

            // 2. Atualiza só o HTML da lista para trocar o ícone do olho (mantendo a rolagem)
            const termoPesq = document.getElementById('input-pesquisa-itens') ? document.getElementById('input-pesquisa-itens').value : "";
            const painel = document.querySelector('.flex-1.overflow-y-auto');
            const scrollSalvo = painel ? painel.scrollTop : 0;
            const sanfonas = document.querySelectorAll('.max-h-\\[40vh\\]');
            const scrollSanf = Array.from(sanfonas).map(s => s.scrollTop);

            window.renderizarHTMLInventario(termoPesq);

            const novoPainel = document.querySelector('.flex-1.overflow-y-auto');
            if (novoPainel) novoPainel.scrollTop = scrollSalvo;
            const novasSanfonas = document.querySelectorAll('.max-h-\\[40vh\\]');
            novasSanfonas.forEach((s, i) => { if (scrollSanf[i]) s.scrollTop = scrollSanf[i]; });
        };


        window.modelosLocaisMemoria = {}; // Guarda o modelo vivo até o upload
        window.modeloFisicoGLB = null; // Guarda o arquivo bruto para mandar pra Nuvem

        window.carregarGLBDoPC = function(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const nomeLimpo = file.name.replace(/\s+/g, '_');
            const nomeFinal = 'custom_' + nomeLimpo;
            
            window.modelosLocaisMemoria[nomeFinal] = URL.createObjectURL(file);
            window.modeloFisicoGLB = file; // 🔴 GUARDA O ARQUIVO AQUI!
            
            window.selecionarModelo(nomeFinal);
            event.target.value = "";
        };

        // --- FUNÇÕES DO MODAL ---
        window.abrirCatalogoModelos = function() {
          const inputNome = document.getElementById('input-nome-item');
          if (inputNome.value.trim() === '') {
            alert("⚠️ Digite um nome para o item primeiro (ex: Poste Central).");
            inputNome.focus();
            return;
          }

          const grid = document.getElementById('grid-modelos');
          grid.innerHTML = '';

          // 🔴 PASSO 1: BOTÃO DE UPLOAD DIRETO DO PC (COMO UM CARD DO GRID)
          grid.innerHTML += `
            <label class="flex flex-col items-center justify-center bg-emerald-50/40 p-3 rounded-xl border-2 border-dashed border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-md transition group relative cursor-pointer min-h-[140px]">
              <input type="file" accept=".glb" class="hidden" onchange="window.carregarGLBDoPC(event)">
              
              <div class="w-14 h-14 mb-3 flex items-center justify-center bg-white rounded-full shadow-sm group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-300">
                <svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
              </div>
              
              <span class="text-[11px] font-extrabold text-emerald-800 text-center leading-tight uppercase tracking-wide">Meu Arquivo</span>
              <span class="text-[9px] text-emerald-600/80 mt-1.5 text-center font-bold tracking-widest uppercase">Upload (.GLB)</span>
            </label>
          `;

          // Gera os "cards" para você escolher (Agora com 3D REAL AO VIVO)
          catalogoModelos.forEach(modelo => {
            // Garante que o sistema ache o arquivo na pasta certa
            const caminhoGLB = modelo.arquivo.includes('/') ? modelo.arquivo : "modelos/" + modelo.arquivo;
            
            grid.innerHTML += `
              <button onclick="selecionarModelo('${modelo.arquivo}')" class="flex flex-col items-center justify-center bg-white p-3 rounded-xl border border-gray-200 hover:border-green-500 hover:shadow-md transition group relative">
                
                <div class="w-20 h-20 mb-2 flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden relative">
                  <model-viewer 
                    src="./${caminhoGLB}" 
                    auto-rotate 
                    camera-controls 
                    interaction-prompt="none"
                    shadow-intensity="1"
                    style="width: 100%; height: 100%; background-color: transparent;">
                  </model-viewer>
                  
                  <div class="absolute inset-0 z-10 cursor-pointer"></div>
                </div>
                
                <span class="text-xs font-bold text-gray-700 text-center leading-tight">${modelo.nome}</span>
                <span class="text-[9px] text-gray-400 mt-1 truncate w-full text-center" title="${modelo.arquivo}">${modelo.arquivo}</span>
              </button>
            `;
          });

          document.getElementById('modal-catalogo').classList.remove('hidden');
        };

        window.fecharCatalogoModelos = function() {
          document.getElementById('modal-catalogo').classList.add('hidden');
        };

        window.selecionarModelo = function(arquivoGLB) {
          modeloEscolhidoUrl = arquivoGLB;
          fecharCatalogoModelos();
          
          modoInteracaoMapa = 'adicionar';
          document.getElementById('mapa-container').style.cursor = 'crosshair';
          document.getElementById('msg-instrucao').innerText = `📍 Clique no mapa para plantar o modelo: ${arquivoGLB}`;
          document.getElementById('msg-instrucao').classList.remove('hidden');
        };

        //------- Para colocar glb do pc ----------
        window.usarModeloPersonalizado = function() {
            const inputNome = document.getElementById('input-nome-item');
            
            if (inputNome.value.trim() === '') {
                alert("⚠️ Digite um nome para o item primeiro (ex: Coreto Histórico).");
                inputNome.focus();
                return;
            }

            const urlGLB = prompt("Modelo Exclusivo\n\nDigite o nome do arquivo .glb (que você colocou na pasta do sistema) ou cole o link (URL) completo de um arquivo 3D da internet:");
            
            if (urlGLB && urlGLB.trim() !== "") {
                // Reaproveitamos a função que já prepara o mapa para receber o clique!
                window.selecionarModelo(urlGLB.trim());
            }
        };

      // --- FUNÇÃO QUE DESENHA O ITEM ---
        function criarSimboloGLB(arquivo, escala = 1, rotacao = 0, inclinacao = 0, rolagem = 0, status = "OK") {

          let hrefFinal = "";
          
          if (arquivo.startsWith('nuvem|')) {
              // 🔴 LÊ DIRETO DO BANCO DE DADOS DA PREFEITURA (Sobrevive ao F5)
              hrefFinal = arquivo.substring(6); 
          } else if (arquivo.startsWith('custom_') && window.modelosLocaisMemoria && window.modelosLocaisMemoria[arquivo]) {
              // Usa a memória RAM logo após plantar (Antes de subir pro banco)
              hrefFinal = window.modelosLocaisMemoria[arquivo]; 
          } else {
              // Lógica original para os arquivos da sua pasta 'modelos/'
              if (!arquivo.toLowerCase().endsWith('.glb')) arquivo += '.glb';
              let arquivoLimpo = arquivo.startsWith('custom_') ? arquivo.substring(7) : arquivo;
              const caminhoArquivo = arquivoLimpo.includes('/') ? arquivoLimpo : "modelos/" + arquivoLimpo;
              hrefFinal = "./" + caminhoArquivo;
          }
          
          const configuracaoObjeto = {
            type: "object",
            resource: { href: hrefFinal },
            height: 3 * escala, 
            heading: rotacao,     
            tilt: inclinacao,     
            roll: rolagem         
          };

          // O FANTASMA CINZA: Mescla a textura original com um cinza translúcido
          if (status === "Necessita Conserto") {
            configuracaoObjeto.material = { color: [107, 114, 128, 0.80] }; 
          }

          return {
            type: "point-3d",
            symbolLayers: [configuracaoObjeto]
          };
        }

        window.ativarModoMover = function(id) {
          modoInteracaoMapa = 'mover';
          idItemSendoMovido = id;
          document.getElementById('mapa-container').style.cursor = 'crosshair';
          document.getElementById('msg-instrucao').innerText = "📍 Clique no novo local do mapa para MOVER.";
          document.getElementById('msg-instrucao').classList.remove('hidden');
        };

        function cancelarAcaoMapa() {
          modoInteracaoMapa = null;
          idItemSendoMovido = null;
          document.getElementById('mapa-container').style.cursor = 'default';
          document.getElementById('msg-instrucao').classList.add('hidden');
        }

        // Variável para guardar o estado do contorno azul
        let highlightHover = null;

        window.tooltipSlideshowInterval = null;
        window.tooltipCurrentSlide = 0;

        // --- MOTOR LIGA/DESLIGA DO CARD FLUTUANTE ---
        window.hoverHabilitado = true;
        
        window.toggleHoverObjetos = function(event) {
            // A MÁGICA: Impede que o clique no olho dispare o clique da sanfona!
            if (event) event.stopPropagation(); 
            
            window.hoverHabilitado = !window.hoverHabilitado;
            
            const btn = document.getElementById('btn-toggle-hover');
            const iconeOn = document.getElementById('icone-hover-on');
            const iconeOff = document.getElementById('icone-hover-off');
            
            if (window.hoverHabilitado) {
                // LIGA: Olho verde vibrante
                btn.classList.remove('text-slate-400', 'hover:text-slate-600');
                btn.classList.add('text-emerald-800', 'hover:text-emerald-950');
                iconeOn.classList.replace('hidden', 'block');
                iconeOff.classList.replace('block', 'hidden');
            } else {
                // DESLIGA: Olho cinza riscado
                btn.classList.remove('text-emerald-800', 'hover:text-emerald-950');
                btn.classList.add('text-slate-400', 'hover:text-slate-600');
                iconeOn.classList.replace('block', 'hidden');
                iconeOff.classList.replace('hidden', 'block');
                
                // Força o card a sumir imediatamente, mas sem remover o contorno!
                const tooltip = document.getElementById('custom-tooltip');
                if (tooltip) {
                    tooltip.classList.add('hidden');
                    tooltip.classList.remove('flex');
                }
            }
        };

        // --- HOVER COM TOOLTIP CUSTOMIZADO E CONTORNO AZUL ---
        view.on("pointer-move", function(event) {
          const tooltip = document.getElementById('custom-tooltip');

          // 1. Se estiver adicionando ou movendo itens no mapa, bloqueia tudo (contorno e card)
          if (modoInteracaoMapa !== null) {
            tooltip.classList.add('hidden');
            tooltip.classList.remove('flex');
            if (highlightHover) { highlightHover.remove(); highlightHover = null; }
            document.getElementById('mapa-container').style.cursor = 'crosshair';
            return;
          }

          view.hitTest(event, { include: graphicsLayer }).then(function(response) {
            // Verifica se achou algum gráfico E se ele tem o atributo "nome"
            const hitResult = response.results.find(res => res.graphic.attributes && res.graphic.attributes.nome);

            if (hitResult) {
              const graphicHovered = hitResult.graphic;
              
              // --- A MÁGICA DO CONTORNO AZUL (Sempre acontece, independente do interruptor) ---
              view.whenLayerView(graphicsLayer).then(function(layerView) {
                if (highlightHover) { highlightHover.remove(); }
                highlightHover = layerView.highlight(graphicHovered);
              });
              
              document.getElementById('mapa-container').style.cursor = 'pointer';

              // --- A TRAVA DO CARD (Se o interruptor estiver desligado, para por aqui) ---
              if (window.hoverHabilitado === false) {
                  tooltip.classList.add('hidden');
                  tooltip.classList.remove('flex');
                  return;
              }
              
              // 1. Preenche os Textos
              document.getElementById('tooltip-title').innerText = graphicHovered.attributes.nome;
              const statusLocal = graphicHovered.attributes.status || "OK";
              const corStatus = statusLocal === 'OK' ? 'text-green-600' : 'text-red-600';
              document.getElementById('tooltip-status').innerHTML = `Status: <b class="${corStatus}">${statusLocal}</b>`;
              
              // 2. O MÁGICO CARROSSEL AUTOMÁTICO (SLIDESHOW) E AUMENTO DO CARD
              const itemBanco = window.bancoDeDadosItens.find(i => i.id === graphicHovered.attributes.idVisual);
              const imgTooltip = document.getElementById('tooltip-image');
              const tooltipCaixa = document.getElementById('custom-tooltip');
              
              // Aumenta o tamanho do card! (w-48 = 192px -> w-72 = 288px | h-24 -> h-48 = 192px)
              tooltipCaixa.classList.remove('w-48');
              tooltipCaixa.classList.add('w-72');
              imgTooltip.classList.remove('h-24');
              imgTooltip.classList.add('h-48');
              
              if (!document.getElementById('tooltip-desc-box')) {
                  imgTooltip.insertAdjacentHTML('afterend', `
                      <div id="tooltip-desc-box" class="absolute bottom-[65px] left-0 right-0 bg-slate-900/80 backdrop-blur-sm text-white text-[11px] p-2 text-center leading-tight shadow-sm" style="display:none;"></div>
                      <div id="tooltip-contador" class="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-white font-bold text-[10px] px-2 py-1 rounded-full z-10" style="display:none;"></div>
                      <!-- NOVO: Badge da Data da Foto -->
                      <div id="tooltip-data-foto" class="absolute top-2 left-2 bg-emerald-700/90 backdrop-blur-md text-white font-bold text-[9px] px-2 py-1 rounded-md z-10 shadow-sm flex items-center gap-1 uppercase tracking-wider border border-emerald-500/50" style="display:none;"></div>
                  `);
                  imgTooltip.parentElement.classList.add('relative');
              }
              
              const descBox = document.getElementById('tooltip-desc-box');
              const contBox = document.getElementById('tooltip-contador');
              const dataBox = document.getElementById('tooltip-data-foto');

              clearInterval(window.tooltipSlideshowInterval);
              let galeriaHover = window.obterGaleriaCompleta(itemBanco);

              if (galeriaHover.length > 0) {
                  imgTooltip.classList.remove('hidden');
                  imgTooltip.classList.add('block');

                  const tocarSlide = (index) => {
                      imgTooltip.src = galeriaHover[index].url;
                      
                      // Lógica da Descrição
                      if (galeriaHover[index].desc) {
                          descBox.innerText = galeriaHover[index].desc;
                          descBox.style.display = 'block';
                      } else { descBox.style.display = 'none'; }
                      
                      // Lógica da Data (NOVO)
                      if (galeriaHover[index].data) {
                          const dataFormatada = galeriaHover[index].data.split('-').reverse().join('/');
                          dataBox.innerHTML = `<svg class="w-3 h-3 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg> ${dataFormatada}`;
                          dataBox.style.display = 'flex';
                      } else { 
                          dataBox.style.display = 'none'; 
                      }
                      
                      // Lógica do Contador
                      if (galeriaHover.length > 1) {
                          contBox.innerText = `${index + 1} / ${galeriaHover.length}`;
                          contBox.style.display = 'block';
                      } else { contBox.style.display = 'none'; }
                  };

                  window.tooltipCurrentSlide = 0;
                  tocarSlide(0);

                  if (galeriaHover.length > 1) {
                      window.tooltipSlideshowInterval = setInterval(() => {
                          window.tooltipCurrentSlide = (window.tooltipCurrentSlide + 1) % galeriaHover.length;
                          tocarSlide(window.tooltipCurrentSlide);
                      }, 2500); 
                  }
              } else {
                  imgTooltip.classList.add('hidden');
                  imgTooltip.classList.remove('block');
                  descBox.style.display = 'none';
                  contBox.style.display = 'none';
                  dataBox.style.display = 'none'; // Garante que a data suma se não tiver foto
              }
                   
              // 3. A MÁGICA 3D: Pega o "meio" do objeto
              const pontoExatoColisao = hitResult.mapPoint;
              
// 4. Converte essa coordenada real para a tela
const telaCoord = view.toScreen(pontoExatoColisao);

// 5. Posiciona o balão perfeitamente (Mantém o código que já ajustamos)
tooltip.style.left = telaCoord.x + "px"; 
tooltip.style.top = (telaCoord.y - 30) + "px"; 
tooltip.style.transform = "translate(-50%, -100%)"; 
              
              tooltip.classList.remove('hidden');
              tooltip.classList.add('flex');
              document.getElementById('mapa-container').style.cursor = 'pointer';

            } else {
              // --- SE O MOUSE SAIR DO OBJETO, LIMPA TUDO ---
              if (highlightHover) {
                highlightHover.remove();
                highlightHover = null;
              }

              clearInterval(window.tooltipSlideshowInterval);

              // Esconde o balão e volta o mouse ao normal
              tooltip.classList.add('hidden');
              tooltip.classList.remove('flex');
              document.getElementById('mapa-container').style.cursor = 'default';
            }
          });
        });

        // Ouve o clique real no mapa
        view.on("click", function(event) {
          if (modoInteracaoMapa === 'adicionar') {
            event.stopPropagation();
            const nomeDigitado = document.getElementById('input-nome-item').value;
            const geometriaClone = event.mapPoint.clone(); // Pega a geometria perfeita da Esri

            const novoItem = {
              id: Date.now(), 
              praca: pracaAtivaId,
              nome: nomeDigitado,
              arquivo_glb: modeloEscolhidoUrl, 
              status: "OK",
              lon: geometriaClone.longitude || geometriaClone.x,
              lat: geometriaClone.latitude || geometriaClone.y,
              escala: 1, 
              rotacao: 0, 
              altitude: 0,
              geometriaOriginal: geometriaClone
            };
            
            window.bancoDeDadosItens.push(novoItem);
            window.sincronizarAdicaoNuvem(novoItem, geometriaClone); 
            
            document.getElementById('input-nome-item').value = '';
            cancelarAcaoMapa();
            atualizarInterfaceEMapa();
          } 
          else if (modoInteracaoMapa === 'mover') {
            event.stopPropagation();
            
            // 🔴 A CORREÇÃO ESTÁ AQUI: Trocamos "id" por "idItemSendoMovido"
            const item = window.bancoDeDadosItens.find(i => String(i.id) === String(idItemSendoMovido));
            
            if (item) {
              const geometriaNova = event.mapPoint.clone();
              item.lon = geometriaNova.longitude || geometriaNova.x;
              item.lat = geometriaNova.latitude || geometriaNova.y;
              item.geometriaOriginal = geometriaNova;
              
              window.sincronizarAtualizacaoNuvem(item, geometriaNova); 
            }
            cancelarAcaoMapa();
            atualizarInterfaceEMapa();
          }
          else {
            view.hitTest(event).then(function(response) {
              
              // 1. CLIQUE NO OBJETO 3D: Apenas scrolla e destaca o card correspondente (SEM abrir a engrenagem)
              const objetoClicado = response.results.find(res => res.graphic.layer === graphicsLayer && res.graphic.attributes && res.graphic.attributes.idVisual);

              if (objetoClicado) {
                  const idObj = objetoClicado.graphic.attributes.idVisual;
                  const itemBanco = window.bancoDeDadosItens.find(i => i.id === idObj);

                  if (itemBanco) {
                      const nomeGrupo = window.obterNomeGaveta(itemBanco.arquivo_glb);
                      
                      if (document.getElementById('content-inventario').classList.contains('hidden')) {
                          document.getElementById('btn-inventario').click();
                      }

                      // 🔴 A MÁGICA: Força a aba Visão Geral a abrir antes de focar no card!
                      if (typeof window.alternarAbaPraca === 'function' && pracaAtivaId) {
                          window.alternarAbaPraca('geral');
                      }

                      // Abre a sanfona correta, se estiver fechada
                      if (!window.estadoSanfonas[nomeGrupo]) {
                          window.estadoSanfonas[nomeGrupo] = true;
                          window.atualizarInterfaceEMapa(); // Redesenha a lista para abrir a gaveta
                      }

                      // Rola a tela até o card correspondente e aplica o efeito visual de foco (sem abrir sliders)
                      setTimeout(() => {
                          const card = document.getElementById(`card-item-${idObj}`);
                          if (card) {
                              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              card.classList.add('border-purple-500', 'ring-2', 'ring-purple-300', 'bg-purple-50/50');
                              setTimeout(() => card.classList.remove('border-purple-500', 'ring-2', 'ring-purple-300', 'bg-purple-50/50'), 2500);
                          }
                      }, 150); // delay para dar tempo de o HTML da sanfona abrir, se precisou

                      return; // Impede que o clique seja considerado um clique na "grama"
                  }
              }

              // 2. CLIQUE NA PRAÇA (Abre o Inventário da Praça inteira)
              const pracaClicadaHit = response.results.find(
                (resultado) => resultado.graphic.layer && resultado.graphic.layer.id === "pracas-parques"
              );

              if (pracaClicadaHit) {
                const atributos = pracaClicadaHit.graphic.attributes;
                const infoPraca = extrairIdENomePraca(atributos);
                
                if (infoPraca.id === pracaAtivaId) return;

                let lonVoo = event.mapPoint.longitude;
                let latVoo = event.mapPoint.latitude;
                
                if (infoPraca.id === "Matriz") { lonVoo = -51.2305; latVoo = -30.0338; }
                else if (infoPraca.id === "Alfandega") { lonVoo = -51.2295; latVoo = -30.0298; }
                else if (infoPraca.id === "Redencao") { lonVoo = -51.2185; latVoo = -30.0355; }
                else if (infoPraca.id === "Carlesso") { lonVoo = -51.194719; latVoo = -29.984137; }

                window.abrirGestaoPraca(infoPraca.id, infoPraca.nome, lonVoo, latVoo);
                
                if (document.getElementById('content-inventario').classList.contains('hidden')) {
                  document.getElementById('btn-inventario').click();
                }
              } else {
                // CLIQUE FORA (Volta para a lista global de praças)
                if (pracaAtivaId !== null) {
                  window.voltarParaListaPracas();
                }
                
                // 🔴 A MÁGICA DE UX AQUI: Se o usuário estiver vendo os detalhes de uma obra
                // ou no meio de um formulário, clicar fora no mapa age como um "Voltar" universal
                if (typeof window.voltarParaListaObras === 'function') {
                    window.voltarParaListaObras();
                }
              }
            });
          }
        });
      });
    });

// --- MOTOR DE AUTO-GERAÇÃO DE MOBILIÁRIO EM LOTE ---
        window.autoGerarMobiliario = function(idPraca) {
          const pracaGeo = window.todasAsPracas.find(p => p.idOficial === idPraca);
          if (!pracaGeo) return;

          const extrairNumero = (texto) => {
              if (!texto) return 0;
              const num = String(texto).replace(/\D/g, ''); 
              return num ? parseInt(num) : 0;
          };

          const qtdBancos = extrairNumero(pracaGeo.bancos);
          const qtdLixeiras = extrairNumero(pracaGeo.lixeiras);
          const qtdPostes = pracaGeo.iluminacao ? 4 : 0; 

          const totalItens = qtdBancos + qtdLixeiras + qtdPostes;

          if (totalItens === 0 && !pracaGeo.ambientes) {
              alert("⚠️ A base da prefeitura não especifica quantidades nem ambientes para esta praça.");
              return;
          }

          const confirmacao = confirm(`Deseja espalhar os itens menores (bancos/lixeiras) e analisar as estruturas grandes?`);
          if (!confirmacao) return;

          let itensGerados = 0;

          // Matemática para não deixar os itens caírem na rua (Ray Casting)
          const pontoDentroDoPoligono = (lon, lat, polygon) => {
              let inside = false;
              if (!polygon || !polygon.rings) return true; 
              for (let r = 0; r < polygon.rings.length; r++) {
                  let ring = polygon.rings[r];
                  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                      let xi = ring[i][0], yi = ring[i][1];
                      let xj = ring[j][0], yj = ring[j][1];
                      let intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
                      if (intersect) inside = !inside;
                  }
              }
              return inside;
          };

          const choverItensNoMapa = (nome, arquivo_glb, quantidade) => {
              for (let i = 0; i < quantidade; i++) {
                  let lonAleatoria = pracaGeo.lon;
                  let latAleatoria = pracaGeo.lat;
                  
                  if (pracaGeo.extent && pracaGeo.geometriaPoligono) {
                      let achouLocal = false;
                      let tentativas = 0;
                      
                      while (!achouLocal && tentativas < 100) {
                          lonAleatoria = pracaGeo.extent.xmin + Math.random() * (pracaGeo.extent.xmax - pracaGeo.extent.xmin);
                          latAleatoria = pracaGeo.extent.ymin + Math.random() * (pracaGeo.extent.ymax - pracaGeo.extent.ymin);
                          
                          if (pontoDentroDoPoligono(lonAleatoria, latAleatoria, pracaGeo.geometriaPoligono)) {
                              achouLocal = true; 
                          }
                          tentativas++;
                      }
                  }

                  const geometriaPoint = { 
                      type: "point", 
                      longitude: lonAleatoria, 
                      latitude: latAleatoria,
                      spatialReference: { wkid: 4326 }
                  };

                  const novoItem = {
                      id: Date.now() + Math.floor(Math.random() * 100000), 
                      praca: idPraca,
                      nome: `${nome} Automático ${i+1}`,
                      arquivo_glb: arquivo_glb, 
                      status: "OK",
                      lon: geometriaPoint.longitude,
                      lat: geometriaPoint.latitude,
                      escala: 1, 
                      rotacao: Math.floor(Math.random() * 360), 
                      altitude: 0,
                      geometriaOriginal: geometriaPoint
                  };

                  window.bancoDeDadosItens.push(novoItem);
                  window.sincronizarAdicaoNuvem(novoItem, geometriaPoint);
                  itensGerados++;
              }
          };

          if (qtdBancos > 0) choverItensNoMapa("Banco", "low_poly_-_park_bench.glb", qtdBancos);
          if (qtdLixeiras > 0) choverItensNoMapa("Lixeira", "street_trash_can__low_poly__free.glb", qtdLixeiras);
          if (qtdPostes > 0) choverItensNoMapa("Poste", "street_lamp.glb", qtdPostes);

          // --- RADAR COMPLETO DA PREFEITURA: Busca os 10 ambientes ---
          let avisoAmbientesManuais = "";
          if (pracaGeo.ambientes) {
              const ambText = pracaGeo.ambientes.toLowerCase();
              let detectados = [];
              
              if (ambText.includes("quadra") || ambText.includes("esporte")) detectados.push("⚽ Quadra Esportiva");
              if (ambText.includes("campo")) detectados.push("🏟️ Campo de Futebol");
              if (ambText.includes("cancha") || ambText.includes("bocha")) detectados.push("🎳 Cancha de Bocha");
              if (ambText.includes("skate") || ambText.includes("radical")) detectados.push("🛹 Pista de Skate");
              if (ambText.includes("infantil") || ambText.includes("brinquedo") || ambText.includes("play")) detectados.push("🛝 Playground");
              if (ambText.includes("academia")) detectados.push("🦾 Academia ao Ar Livre");
              if (ambText.includes("ginástica") || ambText.includes("ginastica") || ambText.includes("aparelho")) detectados.push("🏋️ Equip. de Ginástica");
              if (ambText.includes("jogo") || ambText.includes("xadrez") || ambText.includes("dama")) detectados.push("♟️ Mesas de Jogo");
              if (ambText.includes("churrasqueira") || ambText.includes("fogo")) detectados.push("🥩 Churrasqueira");
              if (ambText.includes("estar") || ambText.includes("convivência")) detectados.push("☕ Área de Estar/Pergolado");

              detectados = [...new Set(detectados)]; // Limpa redundâncias

              if (detectados.length > 0) {
                  avisoAmbientesManuais = `\n\n📌 ATENÇÃO - ESTRUTURAS GRANDES:\nO sistema detectou: ${detectados.join(", ")}.\n\nPor favor, adicione estes itens manualmente através do botão 'Novo Mobiliário' para garantir o alinhamento com a imagem de satélite.`;
              }
          }

          alert(`🪄 Mágica concluída! ${itensGerados} itens espalhados pela grama respeitando os limites.${avisoAmbientesManuais}`);
          window.atualizarInterfaceEMapa();
        };

// --- LÓGICA DE NAVEGAÇÃO DA BARRA VERTICAL E GAVETA ---
const btnObras = document.getElementById('btn-obras');
const btnInventario = document.getElementById('btn-inventario');
const btnDashboard = document.getElementById('btn-dashboard');

const contentMapa = document.getElementById('content-mapa');
const contentObras = document.getElementById('content-obras');
const contentInventario = document.getElementById('content-inventario');
const contentDashboard = document.getElementById('content-dashboard');

const painelConteudo = document.getElementById('painel-conteudo');
const textoPainelAtivo = document.getElementById('texto-painel-ativo');
const iconePainelAtivo = document.getElementById('icone-painel-ativo');

// As referências ao Início foram apagadas
const buttons = [btnObras, btnInventario, btnDashboard]; 
const contents = [contentMapa, contentObras, contentInventario, contentDashboard];

const infoPaineis = {
  'btn-obras': { texto: 'Gestão de Obras', icone: '' },
  'btn-inventario': { texto: 'Inventário 3D', icone: '' },
  'btn-dashboard': { texto: 'Dashboard', icone: '' }
};

const wrapperGaveta = document.getElementById('wrapper-gaveta');

function resetTabs() {
  buttons.forEach(btn => {
    // 1. Limpa o estado ATIVO (Verde Brilhante)
    btn.classList.remove('active', 'from-emerald-500', 'via-green-500', 'to-emerald-400', 'scale-110', 'border-emerald-300', 'shadow-[0_0_15px_rgba(52,211,153,0.5)]');
    
    // 2. Limpa o estado INATIVO (Cinza Fosco)
    btn.classList.remove('from-slate-700/50', 'via-slate-800/50', 'to-slate-900/50', 'border-slate-500/30', 'text-slate-400');
    
    // 3. Devolve para o estado PADRÃO (Verde Translúcido)
    btn.classList.add('from-[#15803d]/10', 'via-emerald-700/80', 'to-green-600/30', 'border-white/30', 'text-white');
  });
  contents.forEach(content => {
    content.classList.add('hidden');
    content.classList.remove('block');
  });
}

function switchTab(clickedBtn, contentToShow) {
  const isGavetaAberta = !wrapperGaveta.classList.contains('opacity-0');
  const isBotaoAtivo = clickedBtn ? clickedBtn.classList.contains('active') : false;

  // Se já está aberto, fecha
  if (isGavetaAberta && isBotaoAtivo) {
    window.minimizarPainel();
    return;
  }

  resetTabs();
  
  if (clickedBtn) {
      buttons.forEach(btn => {
          // Remove a cor padrão de TODOS os botões
          btn.classList.remove('from-[#15803d]/10', 'via-emerald-700/80', 'to-green-600/30', 'border-white/30', 'text-white');
          
          if (btn === clickedBtn) {
              // MÁGICA 1: O botão clicado fica verde, salta para frente e brilha
              btn.classList.add('active', 'from-emerald-500', 'via-green-500', 'to-emerald-400', 'scale-110', 'border-emerald-300', 'shadow-[0_0_15px_rgba(52,211,153,0.5)]', 'text-white');
          } else {
              // MÁGICA 2: Os outros botões viram um vidro cinza escuro
              btn.classList.add('from-slate-700/50', 'via-slate-800/50', 'to-slate-900/50', 'border-slate-500/30', 'text-slate-400');
          }
      });
      
      textoPainelAtivo.innerText = infoPaineis[clickedBtn.id].texto;
      iconePainelAtivo.innerText = infoPaineis[clickedBtn.id].icone;
  }

  contentToShow.classList.remove('hidden');
  contentToShow.classList.add('block');
  
  // 🌟 MÁGICA DE POSICIONAMENTO: Joga a gaveta para a DIREITA
  wrapperGaveta.classList.remove('left-[70px]', '-translate-x-12'); // Tira a âncora da esquerda
  wrapperGaveta.classList.add('right-[88px]'); // Fixa na direita
  
  // MÁGICA DA SETA: Aponta para a direita (>)
  const iconeFechar = document.getElementById('icone-fechar-gaveta');
  if (iconeFechar) iconeFechar.classList.remove('rotate-180');
  
  // Abre a gaveta
  wrapperGaveta.classList.remove('translate-x-12', 'opacity-0', 'pointer-events-none');
}

window.minimizarPainel = function() {
  // 🌟 MÁGICA DE ANIMAÇÃO: Verifica de qual lado a gaveta está para esconder pro lado certo!
  if (wrapperGaveta.classList.contains('left-[70px]')) {
      // Se estava na esquerda, esconde animando para a esquerda (-translate)
      wrapperGaveta.classList.add('-translate-x-12', 'opacity-0', 'pointer-events-none');
  } else {
      // Se estava na direita, esconde animando para a direita (+translate)
      wrapperGaveta.classList.add('translate-x-12', 'opacity-0', 'pointer-events-none');
  }
  resetTabs();
};

// NOVA FUNÇÃO: Dedicada apenas para abrir o botão de mapa
window.abrirGavetaMapa = function() {
  const isGavetaAberta = !wrapperGaveta.classList.contains('opacity-0');
  const isMapaAberto = !contentMapa.classList.contains('hidden');
  
  if (isGavetaAberta && isMapaAberto) {
      window.minimizarPainel();
      return;
  }
  
  resetTabs();
  
  // MÁGICA 3: Se a gaveta de Mapa abriu, todos os botões da direita ficam cinzas
  buttons.forEach(btn => {
      btn.classList.remove('from-[#15803d]/10', 'via-emerald-700/80', 'to-green-600/30', 'border-white/30', 'text-white');
      btn.classList.add('from-slate-700/50', 'via-slate-800/50', 'to-slate-900/50', 'border-slate-500/30', 'text-slate-400');
  });

  contentMapa.classList.remove('hidden');
  contentMapa.classList.add('block');
  
  textoPainelAtivo.innerText = "Estilos de Mapa";
  iconePainelAtivo.innerText = "";

  // 🌟 MÁGICA DE POSICIONAMENTO: Joga a gaveta para a ESQUERDA
  wrapperGaveta.classList.remove('right-[88px]', 'translate-x-12'); // Tira a âncora da direita
  wrapperGaveta.classList.add('left-[70px]'); // Fixa pertinho do botão do ArcGIS na esquerda
  
  // MÁGICA DA SETA: Aponta para a esquerda (<) girando 180 graus
  const iconeFechar = document.getElementById('icone-fechar-gaveta');
  if (iconeFechar) iconeFechar.classList.add('rotate-180');
  
  // Abre a gaveta
  wrapperGaveta.classList.remove('-translate-x-12', 'opacity-0', 'pointer-events-none');
};

btnObras.addEventListener('click', () => switchTab(btnObras, contentObras));
btnInventario.addEventListener('click', () => switchTab(btnInventario, contentInventario));
btnDashboard.addEventListener('click', () => {
    switchTab(btnDashboard, contentDashboard);
    window.renderizarDashboard(); 
});




// ============================================================================
// TOUR GUIADO PROFISSIONAL (DRIVER.JS) - COM RETORNO AO INÍCIO
// ============================================================================

const driver = window.driver.js.driver;

// Função inteligente que encerra o tour e abre a gaveta 'Início'
function finalizarTourEAbrirInicio() {
  tourGemeoDigital.destroy(); 
  
  // Apenas garante que a gaveta feche e a tela fique limpa
  if (typeof window.minimizarPainel === 'function') {
      window.minimizarPainel();
  }
}

const tourGemeoDigital = driver({
  showProgress: true,
  allowClose: true,
  overlayColor: 'rgba(0, 0, 0, 0.7)',
  nextBtnText: 'Próximo →',
  prevBtnText: '← Voltar',
  doneBtnText: 'Começar',
  progressText: 'Passo {{current}} de {{total}}',
  
  // Injeta o botão "Pular" perfeitamente alinhado
  onPopoverRendered: (popover) => {
    const navBtns = popover.wrapper.querySelector('.driver-popover-navigation-btns');
    
    if (navBtns && !navBtns.querySelector('.btn-pular-tour')) {
      const btnPular = document.createElement('button');
      btnPular.className = 'btn-pular-tour';
      btnPular.innerText = 'Pular Tour';
      
      // Ao clicar em Pular, chama a nossa função inteligente
      btnPular.onclick = () => finalizarTourEAbrirInicio();
      
      navBtns.insertBefore(btnPular, navBtns.firstChild);
    }
  },

  // Se o usuário fechar no "X" ou clicar fora, também vai para o Início
  onDestroyStarted: () => {
    finalizarTourEAbrirInicio();
  },

  steps: [
    {
      popover: {
        title: 'Bem-vindo ao Gêmeo Digital',
        description: 'Vamos fazer um tour rápido para você conhecer todas as funcionalidades do sistema de zeladoria urbana.',
        side: "center",
        align: 'center'
      }
    },
    {
      element: '#input-pesquisa-global',
      popover: {
        title: 'Busca Inteligente',
        description: 'Aqui você pode pesquisar rapidamente por qualquer praça, parque ou rua específica do município.',
        side: "bottom",
        align: 'center'
      }
    },
    {
      element: '#slider-mescla-mapa',
      popover: {
        title: 'Visão de Satélite',
        description: 'Utilize esta barra para mesclar a planta vetorial oficial com as imagens de satélite em alta resolução.',
        side: "top",
        align: 'center'
      }
    },
    {
      element: '#barra-lateral',
      popover: {
        title: 'Menu de Ferramentas',
        description: 'Esta é a sua central de controle. Vamos conhecer cada uma das ferramentas em ação.',
        side: "left",
        align: 'center'
      },
      onHighlightStarted: () => { window.minimizarPainel(); }
    },
    {
      element: '#btn-dashboard',
      popover: {
        title: 'Dashboard Analítico',
        description: 'Tenha uma visão executiva consolidada de todo o investimento e status de manutenção do município.',
        side: "left",
        align: 'center'
      },
      onHighlightStarted: () => { document.getElementById('btn-dashboard').click(); }
    },
    {
      element: '#btn-inventario',
      popover: {
        title: 'Inventário 3D',
        description: 'Gerencie o mobiliário urbano. Adicione, mova ou altere o status de conservação de bancos, postes, quadras e árvores.',
        side: "left",
        align: 'center'
      },
      onHighlightStarted: () => { document.getElementById('btn-inventario').click(); }
    },
    {
      element: '#btn-obras',
      popover: {
        title: 'Gestão de Obras',
        description: 'Acompanhe todas as revitalizações e construções em andamento, verifique orçamentos e prazos.',
        side: "left",
        align: 'center'
      },
      onHighlightStarted: () => { document.getElementById('btn-obras').click(); }
    },
    {
      element: '#btn-mapa-esri',
      popover: {
        title: 'Estilos de Mapa',
        description: 'Altere a visualização do mapa base, escolhendo entre mapas rodoviários, topográficos ou escuros.',
        side: "right",
        align: 'center'
      },
      onHighlightStarted: () => { 
          if (typeof window.abrirGavetaMapa === 'function') window.abrirGavetaMapa(); 
      }
    },
    {
      element: '#btn-ajuda-esri',
      popover: {
        title: 'Rever Tutorial',
        description: 'Se precisar relembrar como utilizar as ferramentas do sistema, basta clicar neste botão a qualquer momento.',
        side: "right",
        align: 'center'
      },
      onHighlightStarted: () => { 
          if (typeof window.minimizarPainel === 'function') window.minimizarPainel(); 
      }
    },
    {
      popover: {
        title: 'Pronto para explorar!',
        description: 'Use o botão esquerdo para arrastar e o botão direito para inclinar a câmera em 3D. Clique em qualquer praça para começar.',
        side: "center",
        align: 'center'
      },
      onHighlightStarted: () => { window.minimizarPainel(); }
    }
  ]
});

// ============================================================================
// AUTO-START DO TOUR 
// ============================================================================

setTimeout(() => {
    if (!localStorage.getItem('tourGemeoVisto')) {
        tourGemeoDigital.drive();
        localStorage.setItem('tourGemeoVisto', 'true');
    }
}, 1500);

// Acionado pelo botão "Rever Tutorial" da gaveta "Início"
window.iniciarTour = function() {
    window.minimizarPainel();
    tourGemeoDigital.drive();
};

window.alternarAbaPraca = function(abaDesejada) {
    const abas = ['geral', 'gestao'];
    const classeAtiva = "flex-1 pb-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 border-b-2 border-emerald-500 transition-all";
    const classeInativa = "flex-1 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition-all";

    abas.forEach(id => {
        const elAba = document.getElementById(`aba-${id}`);
        const elBtn = document.getElementById(`btn-tab-${id}`);
        
        if (!elAba || !elBtn) return; 

        if (id === abaDesejada) {
            elAba.classList.remove('hidden');
            elAba.classList.add('block');
            elBtn.className = classeAtiva;
        } else {
            elAba.classList.remove('block');
            elAba.classList.add('hidden');
            elBtn.className = classeInativa;
        }
    });
};

// --- MOTOR DO CHECKLIST DE OBRAS ---
window.tarefasTemp = [];

window.adicionarTarefaChecklist = function() {
    const input = document.getElementById('input-nova-tarefa');
    if(!input.value.trim()) return;
    window.tarefasTemp.push({ texto: input.value.trim(), ok: false });
    input.value = '';
    renderizarTarefasForm();
};

window.removerTarefaChecklist = function(index) {
    window.tarefasTemp.splice(index, 1);
    renderizarTarefasForm();
};

window.renderizarTarefasForm = function() {
    const ul = document.getElementById('lista-tarefas-form');
    if (!ul) return;
    ul.innerHTML = window.tarefasTemp.map((t, i) => `
        <li class="flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-200 text-sm shadow-sm group">
          <span class="text-slate-700 font-medium">${t.texto}</span>
          <button type="button" onclick="removerTarefaChecklist(${i})" class="text-slate-300 hover:text-red-500 font-black transition-colors px-2">X</button>
        </li>
    `).join('');
    document.getElementById('form-obra-checklist').value = JSON.stringify(window.tarefasTemp);
};


window.toggleTarefaChecklist = function(idObra, indexTarefa, isChecked) {
    const obra = window.bancoDeDadosItens.find(o => o.id === idObra);
    if(!obra) return;
    
    let tarefasBase = [];
    let logsSalvos = [];
    try { 
        let parsed = JSON.parse(obra.obra_checklist || '[]'); 
        if (Array.isArray(parsed)) tarefasBase = parsed;
        else {
            tarefasBase = parsed.t || parsed.tarefas || [];
            logsSalvos = parsed.l || parsed.logs || [];
        }
    } catch(e) {}
    
    if(tarefasBase[indexTarefa]) {
        tarefasBase[indexTarefa].ok = isChecked;
        obra.obra_checklist = JSON.stringify({ t: tarefasBase, l: logsSalvos }); 
        
        if (tarefasBase.length > 0) {
            const concluidas = tarefasBase.filter(tarefa => tarefa.ok).length;
            obra.obra_progresso = Math.round((concluidas / tarefasBase.length) * 100);
            if (obra.obra_progresso === 100) obra.obra_status = "Concluído";
            else if (obra.obra_progresso > 0) obra.obra_status = "Em Execução";
        }
        
        window.sincronizarAtualizacaoNuvem(obra);
        window.abrirDetalheObra(idObra); 
        if (pracaAtivaId && typeof window.atualizarInterfaceEMapa === 'function') window.atualizarInterfaceEMapa(); 
    }
};

window.removerTarefaDireto = function(idObra, indexTarefa) {
    if(!confirm("Deseja realmente remover esta etapa do projeto?")) return;
    const obra = window.bancoDeDadosItens.find(o => o.id === idObra);
    if(!obra) return;
    
    let tarefasBase = [];
    let logsSalvos = [];
    try { 
        let parsed = JSON.parse(obra.obra_checklist || '[]'); 
        if (Array.isArray(parsed)) tarefasBase = parsed;
        else {
            tarefasBase = parsed.t || parsed.tarefas || [];
            logsSalvos = parsed.l || parsed.logs || [];
        }
    } catch(e) {}
    
    tarefasBase.splice(indexTarefa, 1);
    obra.obra_checklist = JSON.stringify({ t: tarefasBase, l: logsSalvos });
    
    if (tarefasBase.length > 0) {
        const concluidas = tarefasBase.filter(tarefa => tarefa.ok).length;
        obra.obra_progresso = Math.round((concluidas / tarefasBase.length) * 100);
        if (obra.obra_progresso === 100) obra.obra_status = "Concluído";
        else if (obra.obra_progresso > 0) obra.obra_status = "Em Execução";
    } else {
        obra.obra_progresso = 0;
        obra.obra_status = "Planejado";
    }
    
    window.sincronizarAtualizacaoNuvem(obra);
    window.abrirDetalheObra(idObra); 
    if (pracaAtivaId && typeof window.atualizarInterfaceEMapa === 'function') window.atualizarInterfaceEMapa(); 
};

// --- MOTOR DE HISTÓRICO DE OBRAS (TIMELINE) ---
window.abrirModalLogObra = function(idObra) {
    const obra = window.bancoDeDadosItens.find(o => o.id === idObra);
    if (!obra) return;

    let logs = [];
    try { 
        let parsed = JSON.parse(obra.obra_checklist || '{}'); 
        if (parsed.l) logs = parsed.l; // Extrai o log minificado da nuvem!
        else if (parsed.logs) logs = parsed.logs;
    } catch(e) {}

    const modalExistente = document.getElementById('modal-log-obra');
    if (modalExistente) modalExistente.remove();

    let logsHTML = '';
    if (logs.length === 0) {
        logsHTML = '<p class="text-[11px] text-slate-400 text-center py-6 italic border border-dashed border-slate-200 rounded-xl">Nenhum registro de alteração encontrado.</p>';
    } else {
        // Inverte a ordem para o mais recente ficar no topo
        logs.slice().reverse().forEach((log, index) => {
            const isCriacao = log.a === 'Criação';
            const corIcone = isCriacao ? 'text-emerald-500 bg-emerald-100' : 'text-blue-500 bg-blue-100';
            const icone = isCriacao 
                ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"></path></svg>`
                : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>`;

            const linhaTimeline = index !== logs.length - 1 ? '<div class="absolute top-8 bottom-[-16px] left-[15px] w-0.5 bg-slate-100"></div>' : '';

            // O sistema transforma o "código secreto" num visual executivo apenas aqui:
            let detalhesHTML = "";
            if (log.m && log.m.length > 0) {
                detalhesHTML = "<ul class='list-disc pl-4 mt-1 space-y-0.5 text-slate-500 font-medium'>" + log.m.map(msg => {
                    // Pinta o novo valor de verde se tiver a setinha "➔"
                    if (msg.includes(' ➔ ')) {
                        const partes = msg.split(' ➔ ');
                        return `<li>${partes[0]} ➔ <span class="text-emerald-600 font-bold">${partes[1]}</span></li>`;
                    }
                    return `<li>${msg}</li>`;
                }).join('') + "</ul>";
            } else {
                detalhesHTML = "<span class='text-slate-500 font-medium'>Dados estruturais atualizados.</span>";
            }

            logsHTML += `
                <div class="relative flex gap-3 mb-4">
                    ${linhaTimeline}
                    <div class="relative z-10 w-8 h-8 rounded-full ${corIcone} flex items-center justify-center shrink-0 shadow-sm border border-white">
                        ${icone}
                    </div>
                    <div class="flex-1 bg-slate-50 border border-slate-100 p-3.5 rounded-xl shadow-sm hover:border-slate-200 transition-colors">
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-[10px] font-black uppercase tracking-widest text-slate-700">${log.a || log.acao}</span>
                            <span class="text-[9px] text-slate-400 font-bold bg-white px-2 py-0.5 rounded border border-slate-100 shadow-sm">${log.d || log.dataHora}</span>
                        </div>
                        <div class="text-[11px] text-slate-600 leading-relaxed">${detalhesHTML}</div>
                    </div>
                </div>
            `;
        });
    }

    document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-log-obra" class="fixed inset-0 z-[9999999] bg-black/60 flex items-center justify-center backdrop-blur-sm transition-opacity">
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 flex flex-col max-h-[85vh] mx-4 relative overflow-hidden border border-slate-200">
        
        <div class="flex justify-between items-center border-b border-slate-100 pb-4 mb-5 shrink-0">
          <h3 class="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Histórico da Obra
          </h3>
          <button onclick="document.getElementById('modal-log-obra').remove()" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-1.5 rounded-lg transition-all">&times;</button>
        </div>
        
        <div class="flex-1 overflow-y-auto pr-2 pb-2">
            ${logsHTML}
        </div>
        
      </div>
    </div>`);
};


// =====================================================================
        // MOTOR DO VISUALIZADOR DE FOTOS EM TELA CHEIA
        // =====================================================================
        
        window.fotosVisualizador = [];
        window.indiceFotoAtual = 0;

        window.abrirVisualizadorFotos = function(id) {
            const item = window.bancoDeDadosItens.find(i => String(i.id) === String(id) || String(i.idVisual) === String(id));
            if (!item) return;

            const galeria = window.obterGaleriaCompleta(item);
            if (galeria.length === 0) {
                alert("Este item ainda não possui fotos cadastradas na galeria.");
                return;
            }

            window.fotosVisualizador = galeria;
            window.indiceFotoAtual = 0;

            const modalExistente = document.getElementById('modal-visualizador-fotos');
            if (modalExistente) modalExistente.remove();

            // Gera as miniaturas do rodapé
            const miniaturasHTML = galeria.map((foto, index) => `
                <img src="${foto.url}" onclick="window.irParaFotoVisualizador(${index}, event)" class="w-16 h-16 object-cover rounded-lg cursor-pointer border-2 transition-all opacity-50 hover:opacity-100 ${index === 0 ? 'border-emerald-500 opacity-100 shadow-[0_0_10px_#10b981]' : 'border-transparent'}" id="miniatura-foto-${index}">
            `).join('');

            document.body.insertAdjacentHTML('beforeend', `
            <div id="modal-visualizador-fotos" class="fixed inset-0 z-[9999999] bg-black/95 flex flex-col items-center justify-center backdrop-blur-md transition-opacity">
                
                <!-- Controles Superiores -->
                <div class="absolute top-6 right-6 flex items-center gap-4 z-50">
                    <button onclick="window.toggleTelaCheiaVisualizador()" class="text-white/60 hover:text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-xl transition-all shadow-sm" title="Alternar Tela Cheia">
                        <svg id="icone-tela-cheia" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                    </button>
                    <button onclick="window.fecharVisualizadorFotos()" class="text-white/60 hover:text-red-500 bg-white/10 hover:bg-red-500/20 p-2.5 rounded-xl transition-all shadow-sm" title="Fechar Visualizador (ESC)">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <!-- Cabeçalho (Título e Descrição) -->
                <div class="absolute top-8 left-8 z-50 max-w-lg pointer-events-none">
                    <h3 style="font-family: 'Orbitron', sans-serif;" class="text-2xl md:text-3xl font-black uppercase tracking-widest bg-gradient-to-r from-green-300 to-emerald-500 bg-clip-text text-transparent leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] mb-2">${item.nome}</h3>
                    <div class="flex flex-col items-start gap-1">
                        <div class="inline-block bg-black/50 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-lg">
                            <p id="desc-foto-atual" class="text-emerald-300 text-sm font-medium tracking-wide">${galeria[0].desc || 'Sem descrição vinculada a esta imagem'}</p>
                        </div>
                        <div id="container-data-foto" class="${galeria[0].data ? 'block' : 'hidden'} inline-block bg-black/50 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-md">
                            <span class="text-white/80 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                                <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                <span id="data-foto-atual">${galeria[0].data ? galeria[0].data.split('-').reverse().join('/') : ''}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Contador Central -->
                <div class="absolute top-8 left-1/2 -translate-x-1/2 bg-black/60 px-4 py-1.5 rounded-full text-white/90 font-black text-xs tracking-widest uppercase border border-white/10 shadow-sm z-50">
                    <span id="contador-foto-atual">1</span> / ${galeria.length}
                </div>

                <!-- Imagem Principal e Setas de Navegação -->
                <div class="relative w-full h-[75vh] flex items-center justify-center px-16 group select-none">
                    <img id="img-visualizador-principal" src="${galeria[0].url}" class="max-w-full max-h-full object-contain rounded-xl shadow-2xl transition-all duration-300">
                    
                    ${galeria.length > 1 ? `
                        <button onclick="window.mudarFotoVisualizador(-1, event)" class="absolute left-6 top-1/2 -translate-y-1/2 text-white/40 hover:text-white bg-black/50 hover:bg-black/90 p-4 rounded-full transition-all opacity-0 group-hover:opacity-100 hover:scale-110 shadow-lg border border-white/10">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <button onclick="window.mudarFotoVisualizador(1, event)" class="absolute right-6 top-1/2 -translate-y-1/2 text-white/40 hover:text-white bg-black/50 hover:bg-black/90 p-4 rounded-full transition-all opacity-0 group-hover:opacity-100 hover:scale-110 shadow-lg border border-white/10">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                    ` : ''}
                </div>

                <!-- Barra de Miniaturas (Carrossel Inferior) -->
                ${galeria.length > 1 ? `
                    <div class="absolute bottom-8 w-full flex justify-center gap-3 px-6 overflow-x-auto pb-2 z-50">
                        ${miniaturasHTML}
                    </div>
                ` : ''}
            </div>`);

            // Suporte para teclas do teclado (Setas e ESC)
            document.addEventListener('keydown', window.escutarTeclasVisualizador);
        };

        window.mudarFotoVisualizador = function(direcao, event) {
            if(event) event.stopPropagation();
            let novoIndice = window.indiceFotoAtual + direcao;
            
            // Loop infinito: se passar da última volta pra primeira, e vice-versa
            if (novoIndice < 0) novoIndice = window.fotosVisualizador.length - 1;
            else if (novoIndice >= window.fotosVisualizador.length) novoIndice = 0;
            
            window.irParaFotoVisualizador(novoIndice);
        };

        window.irParaFotoVisualizador = function(index, event) {
            if(event) event.stopPropagation();
            window.indiceFotoAtual = index;
            const foto = window.fotosVisualizador[index];
            
            // Efeito de fade-in suave na troca de imagem
            const imgEl = document.getElementById('img-visualizador-principal');
            imgEl.style.opacity = 0.3;
            imgEl.style.transform = 'scale(0.98)';
            
            setTimeout(() => {
                imgEl.src = foto.url;
                imgEl.style.opacity = 1;
                imgEl.style.transform = 'scale(1)';
            }, 150);

            // Atualiza o painel de informações
            document.getElementById('desc-foto-atual').innerText = foto.desc || 'Sem descrição vinculada a esta imagem';
            
            const elContainerData = document.getElementById('container-data-foto');
            const elDataAtual = document.getElementById('data-foto-atual');
            if (foto.data) {
                elDataAtual.innerText = foto.data.split('-').reverse().join('/');
                elContainerData.classList.remove('hidden');
                elContainerData.classList.add('block');
            } else {
                elContainerData.classList.remove('block');
                elContainerData.classList.add('hidden');
            }
            
            document.getElementById('contador-foto-atual').innerText = index + 1;
        };

        window.fecharVisualizadorFotos = function() {
            const modal = document.getElementById('modal-visualizador-fotos');
            if (modal) {
                // Tira da tela cheia antes de fechar a janela
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(err => console.log(err));
                }
                document.removeEventListener('keydown', window.escutarTeclasVisualizador);
                modal.remove();
            }
        };

        window.toggleTelaCheiaVisualizador = function() {
            const modal = document.getElementById('modal-visualizador-fotos');
            const icone = document.getElementById('icone-tela-cheia');
            
            if (!document.fullscreenElement) {
                // ENTRA em tela cheia
                if (modal.requestFullscreen) modal.requestFullscreen();
                else if (modal.webkitRequestFullscreen) modal.webkitRequestFullscreen();
                else if (modal.msRequestFullscreen) modal.msRequestFullscreen();
                
                // Muda o ícone para "Reduzir"
                icone.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7M4 10h6m0 0V4m0 6l-7-7m17 11h-6m0 0v6m0-6l7 7"></path>`;
            } else {
                // SAI da tela cheia
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
                
                // Retorna o ícone para "Expandir"
                icone.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path>`;
            }
        };

        window.escutarTeclasVisualizador = function(e) {
            if (!document.getElementById('modal-visualizador-fotos')) return;
            if (e.key === 'ArrowRight') window.mudarFotoVisualizador(1);
            if (e.key === 'ArrowLeft') window.mudarFotoVisualizador(-1);
            if (e.key === 'Escape') window.fecharVisualizadorFotos();
        };

        