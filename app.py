# IS-A-BUILDER: conversor de texto a datos estructurados
# Desarrollado por: Moyano Moreno, I. (2026)

import streamlit as st
import pandas as pd
import json
import os
import nltk
import re
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString
from nltk.tokenize import PunktSentenceTokenizer
from langdetect import detect, LangDetectException
import urllib.request
import zipfile

# --- CONFIGURACIÓN DE NLTK ---
@st.cache_resource
def setup_nltk():
    nltk_data_path = './nltk_data'
    if not os.path.exists(os.path.join(nltk_data_path, 'tokenizers/punkt')):
        os.makedirs(nltk_data_path, exist_ok=True)
        url = 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt.zip'
        zip_path = os.path.join(nltk_data_path, 'punkt.zip')
        urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(nltk_data_path)
    nltk.data.path.append(nltk_data_path)
    return PunktSentenceTokenizer()

punkt_tokenizer = setup_nltk()

# --- FUNCIONES DE PROCESAMIENTO ---
FUNCTION_WORDS = {
    'es': {
        'a', 'al', 'algo', 'algunas', 'algunos', 'ante', 'antes', 'aquel',
        'aquella', 'aquellas', 'aquellos', 'aquí', 'cada', 'como', 'con',
        'contra', 'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'durante',
        'e', 'el', 'él', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entre',
        'era', 'eran', 'eras', 'eres', 'es', 'esa', 'esas', 'ese', 'eso',
        'esos', 'esta', 'estaba', 'estaban', 'estado', 'estamos', 'estar',
        'estas', 'este', 'esto', 'estos', 'estoy', 'está', 'están', 'estás',
        'fue', 'fueron', 'fui', 'fuimos', 'ha', 'había', 'han', 'has',
        'hasta', 'hay', 'he', 'hemos', 'la', 'las', 'le', 'les', 'lo',
        'los', 'más', 'me', 'mi', 'mis', 'mucho', 'muchos', 'muy', 'nada',
        'ni', 'no', 'nos', 'nosotras', 'nosotros', 'nuestra', 'nuestro',
        'o', 'os', 'otra', 'otras', 'otro', 'otros', 'para', 'pero', 'por',
        'porque', 'que', 'qué', 'quien', 'quienes', 'se', 'sea', 'ser',
        'si', 'sí', 'sin', 'sobre', 'somos', 'son', 'soy', 'su', 'sus',
        'también', 'te', 'tiene', 'tienen', 'todo', 'todos', 'tu', 'tus',
        'tú', 'un', 'una', 'uno', 'unos', 'vosotras', 'vosotros', 'y', 'ya',
        'yo'
    },
    'en': {
        'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am',
        'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been',
        'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
        'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each',
        'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
        'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
        'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just',
        'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now',
        'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
        'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
        'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
        'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
        'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
        'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
        'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself',
        'yourselves'
    }
}

def normalize_token(token):
    return re.sub(r'^[^\wáéíóúüñÁÉÍÓÚÜÑ]+|[^\wáéíóúüñÁÉÍÓÚÜÑ]+$', '', token.lower())

def detect_language(text):
    try:
        language = detect(text)
        return language if language in FUNCTION_WORDS else 'es'
    except LangDetectException:
        return 'es'

def remove_function_words(text):
    function_words = FUNCTION_WORDS[detect_language(text)]
    return ' '.join(
        token for token in text.split()
        if (normalized := normalize_token(token)) and normalized not in function_words
    )

def clean_text(text, lowercase, remove_stopwords):
    if lowercase:
        text = text.lower()
    if remove_stopwords:
        text = remove_function_words(text)
    return text

def process_txt_files(uploaded_files, segment_by_sentences, lowercase, remove_stopwords):
    structured_data = []
    for uploaded_file in uploaded_files:
        raw_content = uploaded_file.read()
        try:
            content = raw_content.decode('utf-8')
        except UnicodeDecodeError:
            content = raw_content.decode('latin-1')
            
        file_name = uploaded_file.name
        content = clean_text(content, lowercase, remove_stopwords)

        if segment_by_sentences:
            sentences = punkt_tokenizer.tokenize(content)
            for sentence in sentences:
                if sentence.strip():
                    structured_data.append({'fuente': file_name, 'contenido': sentence.strip()})
        else:
            if content.strip():
                structured_data.append({'fuente': file_name, 'contenido': content.strip()})
    return structured_data

def process_manual_text(text, segment_by_sentences, lowercase, remove_stopwords):
    structured_data = []
    text = clean_text(text, lowercase, remove_stopwords)
    if segment_by_sentences:
        sentences = punkt_tokenizer.tokenize(text)
        for sentence in sentences:
            if sentence.strip():
                structured_data.append({'fuente': 'entrada_manual', 'contenido': sentence.strip()})
    else:
        if text.strip():
            structured_data.append({'fuente': 'entrada_manual', 'contenido': text.strip()})
    return structured_data

def save_as_xml(data, content_key, label_keys):
    root = ET.Element('corpus')
    for item in data:
        entry = ET.SubElement(root, 'documento')
        id_element = ET.SubElement(entry, 'id_registro')
        id_element.text = str(item.get('id_registro', ''))
        content_element = ET.SubElement(entry, content_key)
        content_element.text = str(item.get(content_key, ''))
        source_element = ET.SubElement(entry, 'fuente')
        source_element.text = str(item.get('fuente', ''))
        for key in label_keys:
            label_element = ET.SubElement(entry, key)
            label_element.text = 'PENDIENTE'
            
    xml_str = ET.tostring(root, encoding='utf-8')
    dom = parseString(xml_str)
    return dom.toprettyxml(indent='  ')

# --- INTERFAZ DE STREAMLIT ---
st.set_page_config(page_title="IS-A-BUILDER: conversor de texto a datos estructurados", layout="wide")

# --- BARRA LATERAL (FIJA) ---
# Sección de Cita 
st.sidebar.info(
    "**Cómo citar:**\n\n"
    "Moyano Moreno, I. (2026). *IS-A-BUILDER: conversor de texto a datos estructurados*. "
    "[Software]. "
    "[https://doi.org/10.5281/zenodo.18494400](https://doi.org/10.5281/zenodo.18494400)"
)
st.sidebar.markdown("---")

st.sidebar.header("Configuración")
st.sidebar.caption("Procesamiento")
segment_by_sentences = st.sidebar.checkbox('Tokenización por oraciones', value=True)
do_lowercase = st.sidebar.checkbox('Normalizar a minúscula')
do_remove_stopwords = st.sidebar.checkbox(
    'Eliminar palabras funcionales',
    help='Detecta el idioma con langdetect y elimina palabras funcionales en español o inglés.'
)

content_key = st.sidebar.text_input('Etiqueta de contenido', value='texto')
labels_input = st.sidebar.text_input(
    'Etiquetas de metadatos',
    value='sentimiento, categoria',
    help='Escribe las etiquetas separadas por comas. Ejemplo: sentimiento, categoria, dificultad'
)
file_output_name = st.sidebar.text_input('Nombre del archivo de salida', value='dataset_procesado')

label_keys = [label.strip() for label in labels_input.split(',')] if labels_input else []

st.title('**IS-A-BUILDER**: conversor de texto a datos estructurados')
st.caption('© Isabel Moyano Moreno | 2026 | Versión 1.0')

st.markdown("""
En el **procesamiento del lenguaje natural (PLN)**, la calidad de los modelos —desde clasificadores más clásicos hasta los recientes grandes modelos de lenguaje (LLM)— depende directamente de la compilación, estructura y limpieza del corpus lingüístico o *dataset*.

**IS-A-BUILDER** ha sido diseñado específicamente como un recurso pedagógico para estudiantes y personas curiosas e interesadas en el PLN. Esta herramienta facilita la transición del texto plano (`.txt`) a formatos estructurados (**JSON, JSONL, CSV, XML**), permitiendo una preparación de datos acorde a los estándares en PLN.
""")

st.divider()

# --- ENTRADA DE DATOS ---
tab1, tab2 = st.tabs(["Subir archivos", "Pegar texto"])
raw_data_list = []

with tab1:
    uploaded_files = st.file_uploader('Cargar archivos de texto (.txt)', type=['txt'], accept_multiple_files=True)
    if uploaded_files:
        raw_data_list.extend(process_txt_files(uploaded_files, segment_by_sentences, do_lowercase, do_remove_stopwords))

with tab2:
    manual_text = st.text_area("Pega aquí el texto que deseas estructurar:", height=200)
    if manual_text.strip():
        raw_data_list.extend(process_manual_text(manual_text, segment_by_sentences, do_lowercase, do_remove_stopwords))

# --- RESULTADOS ---
if raw_data_list:
    with st.spinner('Estructurando datos...'):
        df = pd.DataFrame([{
            'id_registro': i + 1,
            'fuente': item['fuente'],
            content_key: item['contenido'],
            **{key: '' for key in label_keys}
        } for i, item in enumerate(raw_data_list)])
        
        full_text_str = " ".join(df[content_key].astype(str))
        total_words = len(full_text_str.split())
        total_chars = len(full_text_str)

    st.success(f"Procesamiento completado: {len(df)} ítems generados.")
    
    col_m1, col_m2, col_m3 = st.columns(3)
    col_m1.metric("Ítems", len(df))
    col_m2.metric("Palabras", total_words)
    col_m3.metric("Caracteres", total_chars)

    st.write("### Vista previa del dataset")
    st.dataframe(df.head(15), use_container_width=True)

    st.divider()
    
    st.write("### Exportar dataset")
    c1, c2, c3, c4 = st.columns(4)
    
    export_list = df.to_dict(orient='records')

    with c1:
        json_str = json.dumps(export_list, indent=4, ensure_ascii=False)
        st.download_button('JSON', data=json_str, file_name=f'{file_output_name}.json', mime='application/json', use_container_width=True)
    with c2:
        jsonl_str = '\n'.join([json.dumps(r, ensure_ascii=False) for r in export_list])
        st.download_button('JSONL', data=jsonl_str, file_name=f'{file_output_name}.jsonl', mime='application/jsonl', use_container_width=True)
    with c3:
        csv_data = df.to_csv(index=False).encode('utf-8')
        st.download_button('CSV', data=csv_data, file_name=f'{file_output_name}.csv', mime='text/csv', use_container_width=True)
    with c4:
        xml_data = save_as_xml(export_list, content_key, label_keys)
        st.download_button('XML', data=xml_data, file_name=f'{file_output_name}.xml', mime='application/xml', use_container_width=True)
else:
    st.info("Sube archivos o pega texto para generar el dataset estructurado.")
