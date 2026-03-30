import threading
import os
import requests
from functools import partial
from kivy.config import Config
Config.set('graphics', 'width', '390')
Config.set('graphics', 'height', '844')

from kivymd.app import MDApp
from kivy.animation import Animation
from kivy.lang import Builder
from kivy.uix.screenmanager import ScreenManager, Screen
from kivy.clock import mainthread
from kivy.core.window import Window
from kivymd.uix.card import MDCard
from kivymd.uix.label import MDLabel
from kivymd.uix.button import MDRectangleFlatButton, MDFillRoundFlatIconButton
from kivy.properties import StringProperty, NumericProperty

# =====================================================
# РќРђРЎРўР РћР™РљР FIREBASE (РёР· С‚РІРѕРµРіРѕ google-services.json)
# =====================================================
FIREBASE_API_KEY = "AIzaSyAGLtsZXNg1s_a249Sv0p5cMQgkXbjfKPQ"
PROJECT_ID = "feelfilm-13a52"

# =====================================================
# BACKEND API (Kinopoisk key must stay on server)
# =====================================================
BACKEND_API_BASE = os.getenv("BACKEND_API_BASE", "http://127.0.0.1:8000").rstrip("/")
DEV_BYPASS_AUTH = os.getenv("DEV_BYPASS_AUTH", "1").strip() == "1"

CATEGORY_DEFINITIONS = [
    {"id": "comedy", "label": "Комедия", "icon": "emoticon-happy-outline", "keywords": ["комед"], "content_type": "FILM"},
    {"id": "horror", "label": "Ужасы", "icon": "ghost-outline", "keywords": ["ужас"], "content_type": "FILM"},
    {"id": "action", "label": "Экшн", "icon": "flash-outline", "keywords": ["боевик", "экшн"], "content_type": "FILM"},
    {"id": "thriller", "label": "Триллер", "icon": "target", "keywords": ["триллер"], "content_type": "FILM"},
    {"id": "detective", "label": "Детектив", "icon": "magnify", "keywords": ["детектив"], "content_type": "FILM"},
    {"id": "fantasy", "label": "Фантастика", "icon": "rocket-launch-outline", "keywords": ["фантаст"], "content_type": "FILM"},
    {"id": "fantasy_world", "label": "Фэнтези", "icon": "sword-cross", "keywords": ["фэнтези"], "content_type": "FILM"},
    {"id": "drama", "label": "Драма", "icon": "drama-masks", "keywords": ["драма"], "content_type": "FILM"},
    {"id": "romance", "label": "Романтика", "icon": "heart-outline", "keywords": ["мелодрам", "романт"], "content_type": "FILM"},
    {"id": "adventure", "label": "Приключения", "icon": "compass-outline", "keywords": ["приключ"], "content_type": "FILM"},
    {"id": "family", "label": "Семейное", "icon": "account-group-outline", "keywords": ["семейн", "детск"], "content_type": "FILM"},
    {"id": "crime", "label": "Криминал", "icon": "police-badge-outline", "keywords": ["криминал"], "content_type": "FILM"},
    {"id": "mystic", "label": "Мистика", "icon": "weather-night", "keywords": ["мистик"], "content_type": "FILM"},
    {"id": "anime", "label": "Аниме", "icon": "star-four-points-outline", "keywords": ["аниме"], "content_type": "FILM"},
    {"id": "cartoon", "label": "Мультфильмы", "icon": "baby-face-outline", "keywords": ["мульт", "анимац"], "content_type": "CARTOON"},
    {"id": "documentary", "label": "Документальное", "icon": "camera-outline", "keywords": ["документ"], "content_type": "FILM"},
    {"id": "history", "label": "Историческое", "icon": "bank-outline", "keywords": ["истор"], "content_type": "FILM"},
    {"id": "psychological", "label": "Психологическое", "icon": "brain", "keywords": ["психолог"], "content_type": "FILM"},
    {"id": "series", "label": "Сериалы", "icon": "television-classic", "keywords": ["сериал"], "content_type": "TV_SERIES"},
    {"id": "short", "label": "Короткометражки", "icon": "timer-outline", "keywords": ["короткометраж"], "content_type": "FILM"},
]

CATEGORY_QUERY_ALIAS = {
    "fantasy_world": "fantasy",
}

KV = """
ScreenManager:
    AuthScreen:
    MainScreen:
    DetailsScreen:

<AuthScreen>:
    name: 'auth'
    MDBoxLayout:
        orientation: 'vertical'
        padding: "24dp"
        spacing: "16dp"
        pos_hint: {"center_x": .5, "center_y": .56}
        size_hint_y: None
        height: self.minimum_height
        
        MDBoxLayout:
            orientation: "vertical"
            size_hint_y: None
            height: "72dp"
            spacing: "8dp"

            MDBoxLayout:
                orientation: "horizontal"
                size_hint_y: None
                height: "42dp"
                size_hint_x: None
                width: "200dp"
                pos_hint: {"center_x": .5}
                spacing: "6dp"

                MDIcon:
                    icon: "movie-open"
                    theme_text_color: "Custom"
                    text_color: app.theme_cls.primary_color
                    font_size: "28sp"
                    size_hint: None, None
                    size: "28dp", "28dp"
                    pos_hint: {"center_y": .5}

                MDLabel:
                    text: "FeelFilms"
                    theme_text_color: "Primary"
                    bold: True
                    font_style: "H4"
                    halign: "left"
                    valign: "middle"
                    text_size: self.size
                    size_hint_x: None
                    size_hint_y: None
                    height: "42dp"
                    width: "160dp"

            MDLabel:
                text: "\u041f\u043e\u0434\u0431\u043e\u0440 \u0444\u0438\u043b\u044c\u043c\u043e\u0432 \u043f\u043e \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044e"
                halign: "center"
                theme_text_color: "Secondary"
                font_style: "Caption"
                size_hint_y: None
                height: "20dp"

        Widget:
            size_hint_y: None
            height: "12dp"

        MDTextField:
            id: email
            hint_text: "Email"
            icon_right: "email"
            mode: "rectangle"

        MDTextField:
            id: password
            hint_text: "Пароль"
            password: True
            icon_right: "eye-off"
            mode: "rectangle"

        MDRaisedButton:
            text: "Войти"
            pos_hint: {"center_x": .5}
            size_hint_x: 1
            on_release: app.login(email.text, password.text)

        MDFlatButton:
            text: "Зарегистрироваться"
            pos_hint: {"center_x": .5}
            theme_text_color: "Custom"
            text_color: app.theme_cls.primary_color
            on_release: app.register(email.text, password.text)

        MDLabel:
            id: status_label
            text: ""
            theme_text_color: "Error"
            halign: "center"

<MovieCard>:
    size_hint: .9, .7
    pos_hint: {"center_x": .5, "center_y": .55}
    radius: [20]
    elevation: 2
    canvas.before:
        PushMatrix
        Rotate:
            angle: root.drag_angle
            origin: self.center
    canvas.after:
        PopMatrix

    FloatLayout:
        FitImage:
            source: root.poster
            radius: [20]
            size_hint: 1, 1
            pos_hint: {"x": 0, "y": 0}

        MDBoxLayout:
            orientation: "vertical"
            size_hint: 1, None
            height: "120dp"
            pos_hint: {"x": 0, "y": 0}
            padding: "12dp"
            spacing: "4dp"
            md_bg_color: 0, 0, 0, 0.72

            MDLabel:
                text: root.title
                font_style: "H6"
                bold: True
                color: 1, 1, 1, 1
                size_hint_y: None
                height: "52dp"
                text_size: self.width, None
                max_lines: 2
                shorten: True
                shorten_from: "right"

            MDLabel:
                text: "Rating: " + root.rating
                color: 1, 0.82, 0, 1
                font_style: "Subtitle2"
                size_hint_y: None
                height: "20dp"

            MDLabel:
                text: root.desc
                color: 0.84, 0.84, 0.84, 1
                font_style: "Caption"
                size_hint_y: None
                height: "28dp"
                text_size: self.width, None
                max_lines: 1
                shorten: True
                shorten_from: "right"

<DetailsScreen>:
    name: "details"
    MDBoxLayout:
        orientation: "vertical"

        MDTopAppBar:
            title: "Фильм"
            left_action_items: [["arrow-left", lambda x: app.back_to_main()]]

        ScrollView:
            MDBoxLayout:
                orientation: "vertical"
                adaptive_height: True
                padding: "12dp"
                spacing: "10dp"

                FitImage:
                    id: details_poster
                    source: ""
                    size_hint_y: None
                    height: "320dp"
                    radius: [16]

                MDLabel:
                    id: details_title
                    text: ""
                    font_style: "H5"
                    bold: True
                    adaptive_height: True
                    theme_text_color: "Primary"

                MDLabel:
                    id: details_rating
                    text: "Rating: вЂ”"
                    adaptive_height: True
                    theme_text_color: "Secondary"

                MDLabel:
                    id: details_meta
                    text: ""
                    adaptive_height: True
                    theme_text_color: "Secondary"

                MDLabel:
                    id: details_desc
                    text: "Загрузка описания..."
                    adaptive_height: True
                    theme_text_color: "Primary"

<MainScreen>:
    name: 'main'
    MDBottomNavigation:
        text_color_active: app.theme_cls.primary_color
        
        MDBottomNavigationItem:
            name: 'discover'
            text: 'Подбор'
            icon: 'cards'
            
            FloatLayout:
                MDBoxLayout:
                    orientation: 'vertical'
                    
                    ScrollView:
                        size_hint_y: None
                        height: "60dp"
                        MDBoxLayout:
                            id: category_row
                            orientation: 'horizontal'
                            spacing: "10dp"
                            padding: "10dp"
                            size_hint_x: None
                            width: self.minimum_width

                    MDLabel:
                        text: "Жанры (можно выбрать несколько)"
                        halign: "left"
                        size_hint_y: None
                        height: "20dp"
                        theme_text_color: "Secondary"
                            
                    FloatLayout:
                        id: card_container

                    MDAnchorLayout:
                        anchor_x: "center"
                        anchor_y: "center"
                        size_hint_y: None
                        height: "88dp"

                        MDBoxLayout:
                            orientation: "horizontal"
                            adaptive_width: True
                            spacing: "42dp"

                            MDFloatingActionButton:
                                icon: "close"
                                md_bg_color: 0.2, 0.2, 0.2, 1
                                theme_icon_color: "Custom"
                                icon_color: 1, 0.3, 0.3, 1
                                on_release: app.dislike_movie()

                            MDFloatingActionButton:
                                icon: "heart"
                                md_bg_color: 0.2, 0.2, 0.2, 1
                                theme_icon_color: "Custom"
                                icon_color: 0.3, 1, 0.3, 1
                                on_release: app.like_movie()

                MDLabel:
                    id: discover_status
                    text: "Загрузка..."
                    halign: "center"
                    pos_hint: {"center_y": .6}

        MDBottomNavigationItem:
            name: 'favorites'
            text: 'Избранное'
            icon: 'heart'
            on_tab_press: app.load_favorites()
            
            MDBoxLayout:
                orientation: 'vertical'
                MDLabel:
                    text: "Ваше избранное"
                    font_style: "H5"
                    halign: "center"
                    size_hint_y: None
                    height: "50dp"
                    
                ScrollView:
                    MDGridLayout:
                        id: fav_grid
                        cols: 2
                        adaptive_height: True
                        padding: "10dp"
                        spacing: "10dp"
                        
                MDLabel:
                    id: fav_status
                    text: ""
                    halign: "center"
                    size_hint_y: None
                    height: "24dp"
"""

class MovieCard(MDCard):
    title = StringProperty("")
    poster = StringProperty("")
    rating = StringProperty("")
    desc = StringProperty("")
    drag_angle = NumericProperty(0)
    movie_data = None

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._dragging = False
        self._start_x = 0
        self._triggered_swipe = False

    def on_touch_down(self, touch):
        if not self.collide_point(*touch.pos):
            return super().on_touch_down(touch)
        self._dragging = True
        self._start_x = touch.x
        self._triggered_swipe = False
        self.pos_hint = {}
        return True

    def on_touch_move(self, touch):
        if not self._dragging:
            return super().on_touch_move(touch)
        self.x += touch.dx
        parent = self.parent
        if parent is not None and parent.width:
            offset = self.x - ((parent.width - self.width) / 2)
            self.drag_angle = max(-18, min(18, offset / (parent.width * 0.45) * 18))
        return True

    def on_touch_up(self, touch):
        if not self._dragging:
            return super().on_touch_up(touch)
        self._dragging = False
        if self._triggered_swipe:
            return True

        dx = touch.x - self._start_x
        threshold = self.width * 0.22
        if dx > threshold:
            self._animate_swipe("right")
        elif dx < -threshold:
            self._animate_swipe("left")
        else:
            self._animate_back()
        return True

    def _animate_back(self):
        parent = self.parent
        if parent is None:
            return
        target_x = (parent.width - self.width) / 2
        Animation(x=target_x, drag_angle=0, duration=0.16, t="out_quad").start(self)

    def _animate_swipe(self, direction):
        parent = self.parent
        if parent is None:
            return
        self._triggered_swipe = True
        target_x = parent.width + self.width if direction == "right" else -self.width * 1.4
        target_angle = 24 if direction == "right" else -24
        anim = Animation(x=target_x, drag_angle=target_angle, duration=0.12, t="out_quad")
        app = MDApp.get_running_app()
        anim.bind(on_complete=lambda *_: app.handle_card_swipe(direction))
        anim.start(self)


class FavoriteCard(MDCard):
    movie_data = None

    def on_touch_up(self, touch):
        if self.collide_point(*touch.pos):
            app = MDApp.get_running_app()
            if app and self.movie_data:
                app.open_movie_details(self.movie_data)
                return True
        return super().on_touch_up(touch)

class AuthScreen(Screen):
    pass

class MainScreen(Screen):
    pass

class DetailsScreen(Screen):
    pass

class FeelFilmApp(MDApp):
    id_token = None
    local_id = None
    movies = []
    current_index = 0
    favorites_db = []
    local_favorites = []
    local_favorite_ids = set()
    firestore_warned = False
    details_movie_id = None
    selected_category_ids = set()
    preferences = {"category_weights": {}, "type_weights": {}}

    def build(self):
        self.theme_cls.theme_style = "Dark"
        self.theme_cls.primary_palette = "Red"
        return Builder.load_string(KV)

    def on_start(self):
        # Dev shortcut: open the app directly without auth form.
        if DEV_BYPASS_AUTH:
            self.id_token = None
            self.local_id = "dev-local-user"
            self.switch_to_main()

    # ==========================================
    # FIREBASE: Auth (С‡РµСЂРµР· REST API)
    # ==========================================
    def login(self, email, password):
        self.auth_label().text = "Вход..."
        threading.Thread(target=self._auth_request, args=("signInWithPassword", email, password)).start()

    def register(self, email, password):
        self.auth_label().text = "Регистрация..."
        threading.Thread(target=self._auth_request, args=("signUp", email, password)).start()

    def _auth_request(self, method, email, password):
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:{method}?key={FIREBASE_API_KEY}"
        payload = {"email": email, "password": password, "returnSecureToken": True}
        try:
            res = requests.post(url, json=payload, verify=False) # verify=False РґР»СЏ Android SSL
            data = res.json()
            if "error" in data:
                error_code = data.get("error", {}).get("message", "UNKNOWN_ERROR")
                error_map = {
                    "EMAIL_EXISTS": "Этот email уже зарегистрирован",
                    "INVALID_LOGIN_CREDENTIALS": "Неверный логин или пароль",
                    "WEAK_PASSWORD": "Слабый пароль",
                    "CONFIGURATION_NOT_FOUND": (
                        "Firebase не настроен: включите Authentication "
                        "(Email/Password) и проверьте Web API Key."
                    ),
                }
                self.show_auth_error(
                    error_map.get(
                        error_code,
                        "\u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u0438. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 Firebase."
                    )
                )
            else:
                self.id_token = data["idToken"]
                self.local_id = data["localId"]
                self.switch_to_main()
        except Exception as e:
            self.show_auth_error("Ошибка сети. Проверьте подключение")

    @mainthread
    def show_auth_error(self, msg):
        self.auth_label().text = msg

    @mainthread
    def switch_to_main(self):
        self.root.current = "main"
        self.selected_category_ids = set()
        self.render_category_filters()
        self.reload_movies()

    def auth_label(self):
        return self.root.get_screen('auth').ids.status_label

    def _normalize_rating(self, value):
        if value in (None, "", "null", "?"):
            return "-"
        return str(value)

    def _normalize_desc(self, value):
        if not value:
            return "Description is unavailable"
        text = str(value).strip()
        return text if text else "Description is unavailable"

    def _fetch_movie_details_backend(self, film_id):
        try:
            res = requests.get(
                f"{BACKEND_API_BASE}/api/movies/{film_id}",
                verify=False,
                timeout=20
            )
            if res.status_code != 200:
                return None
            return res.json()
        except Exception:
            return None

    # ==========================================
    # API: РљРёРЅРѕРїРѕРёСЃРє
    # ==========================================
    def _normalize_genres(self, source):
        if isinstance(source, list):
            return [str(g.get("genre", "")).strip() for g in source if g and g.get("genre")]
        if isinstance(source, str):
            return [g.strip() for g in source.split(",") if g.strip()]
        return []

    def _infer_content_type(self, raw_type, genres):
        type_text = str(raw_type or "").upper()
        haystack = " ".join(genres).lower()
        if "TV" in type_text or "сериал" in haystack:
            return "TV_SERIES"
        if "мульт" in haystack or "анимац" in haystack:
            return "CARTOON"
        return "FILM"

    def _infer_category_ids(self, movie):
        haystack = f"{movie.get('title', '')} {movie.get('desc', '')} {' '.join(movie.get('genres', []))}".lower()
        found = []
        for category in CATEGORY_DEFINITIONS:
            if category["content_type"] == "TV_SERIES" and movie.get("content_type") == "TV_SERIES":
                found.append(category["id"])
                continue
            if category["content_type"] == "CARTOON" and movie.get("content_type") == "CARTOON":
                found.append(category["id"])
                continue
            if any(keyword in haystack for keyword in category["keywords"]):
                found.append(category["id"])
        return list(dict.fromkeys(found))

    def _compute_preferences(self):
        category_scores = {}
        type_scores = {}
        for movie in self.local_favorites:
            for category_id in movie.get("category_ids", []):
                category_scores[category_id] = category_scores.get(category_id, 0) + 1
            c_type = movie.get("content_type", "FILM")
            type_scores[c_type] = type_scores.get(c_type, 0) + 1

        cat_max = max([1] + list(category_scores.values()))
        type_max = max([1] + list(type_scores.values()))
        self.preferences = {
            "category_weights": {k: v / cat_max for k, v in category_scores.items()},
            "type_weights": {k: v / type_max for k, v in type_scores.items()},
        }

    def _score_movie(self, movie):
        score = 0.0
        try:
            score += float(movie.get("rating", "-").replace(",", ".")) * 3
        except Exception:
            pass

        selected = list(self.selected_category_ids)
        if selected:
            matches = [cat for cat in selected if cat in movie.get("category_ids", [])]
            if matches:
                score += 80 + len(matches) * 25
            else:
                score -= 35

        for category_id in movie.get("category_ids", []):
            score += self.preferences["category_weights"].get(category_id, 0) * 35
        score += self.preferences["type_weights"].get(movie.get("content_type", "FILM"), 0) * 20

        if str(movie.get("id", "")) in self.local_favorite_ids:
            score -= 500
        return score

    def _sort_movies_for_user(self):
        self.movies.sort(key=self._score_movie, reverse=True)

    def _selected_content_type(self):
        types = []
        for category in CATEGORY_DEFINITIONS:
            if category["id"] in self.selected_category_ids:
                types.append(category["content_type"])
        if not types:
            return "ALL"
        mapped = ["FILM" if t == "CARTOON" else t for t in types]
        unique_types = set(mapped)
        return mapped[0] if len(unique_types) == 1 else "ALL"

    def _selected_categories_query(self):
        if not self.selected_category_ids:
            return "all"
        mapped = [CATEGORY_QUERY_ALIAS.get(category_id, category_id) for category_id in self.selected_category_ids]
        return ",".join(dict.fromkeys(mapped))

    def _filter_movies_by_selected_categories(self, movies):
        if not self.selected_category_ids:
            return movies
        selected = set(self.selected_category_ids)
        filtered = [m for m in movies if selected.intersection(set(m.get("category_ids", [])))]
        if filtered:
            return filtered

        # Relaxed fallback: keep items that textually match selected categories.
        relaxed = []
        category_by_id = {c["id"]: c for c in CATEGORY_DEFINITIONS}
        for movie in movies:
            haystack = f"{movie.get('title', '')} {movie.get('desc', '')} {' '.join(movie.get('genres', []))}".lower()
            for category_id in selected:
                category = category_by_id.get(category_id)
                if not category:
                    continue
                if any(keyword in haystack for keyword in category.get("keywords", [])):
                    relaxed.append(movie)
                    break
        if relaxed:
            return relaxed

        # Do not show empty screen if API already returned items.
        return movies

    @mainthread
    def render_category_filters(self):
        row = self.root.get_screen('main').ids.category_row
        row.clear_widgets()

        selected = [c for c in CATEGORY_DEFINITIONS if c["id"] in self.selected_category_ids]
        rest = [c for c in CATEGORY_DEFINITIONS if c["id"] not in self.selected_category_ids]
        ordered = selected + rest

        for category in ordered:
            is_selected = category["id"] in self.selected_category_ids
            button = MDFillRoundFlatIconButton(
                icon=category["icon"],
                text=category["label"],
                line_color=(0.5, 0.5, 0.5, 1) if is_selected else (0.35, 0.35, 0.35, 1),
                text_color=(0.88, 0.88, 0.88, 1) if is_selected else (0.72, 0.72, 0.72, 1),
            )
            button.theme_text_color = "Custom"
            button.theme_icon_color = "Custom"
            button.icon_color = (0.88, 0.88, 0.88, 1) if is_selected else (0.72, 0.72, 0.72, 1)
            if is_selected:
                button.md_bg_color = (0.45, 0.45, 0.45, 1)
            else:
                button.md_bg_color = (0.12, 0.12, 0.12, 1)
            button.bind(on_release=partial(self.toggle_category, category["id"]))
            row.add_widget(button)

    def toggle_category(self, category_id, *_):
        if category_id in self.selected_category_ids:
            self.selected_category_ids.remove(category_id)
        else:
            self.selected_category_ids.add(category_id)
        self.render_category_filters()
        self.reload_movies()

    def reload_movies(self):
        self.root.get_screen('main').ids.discover_status.text = "Загружаем фильмы..."
        self.root.get_screen('main').ids.card_container.clear_widgets()
        threading.Thread(target=self._fetch_movies).start()

    def set_mood(self, mood):
        # Backward compatibility for old handlers, if any.
        self.selected_category_ids = set() if mood == "all" else {mood}
        self.render_category_filters()
        self.reload_movies()

    def _fetch_movies(self):
        url = f"{BACKEND_API_BASE}/api/movies"
        try:
            all_raw = []
            for page in (1, 2, 3):
                params = {
                    "mood": "all",
                    "categories": self._selected_categories_query(),
                    "content_type": self._selected_content_type(),
                    "page": page
                }
                res = requests.get(url, params=params, verify=False, timeout=20)
                if res.status_code != 200:
                    continue
                data = res.json()
                raw = data.get('items', []) or data.get('films', [])
                if not raw:
                    continue
                all_raw.extend(raw)
                if len(all_raw) >= 60:
                    break

            if all_raw:
                self.movies = []
                seen_ids = set()
                for f in all_raw:
                    raw_rating = f.get("ratingKinopoisk", f.get("rating", ""))
                    film_id = str(f.get("kinopoiskId", f.get("filmId", "")))
                    if not film_id or film_id in seen_ids:
                        continue
                    seen_ids.add(film_id)
                    desc = self._normalize_desc(f.get("description") or f.get("shortDescription"))
                    if desc == "Description is unavailable" and film_id:
                        details = self._fetch_movie_details_backend(film_id)
                        if details:
                            desc = self._normalize_desc(details.get("description") or details.get("shortDescription"))

                    genres = self._normalize_genres(f.get("genres"))
                    content_type = self._infer_content_type(f.get("type"), genres)
                    movie = {
                        "id": film_id,
                        "title": f.get("nameRu", f.get("nameEn", "No title")),
                        "poster": f.get("posterUrlPreview", ""),
                        "rating": self._normalize_rating(raw_rating),
                        "desc": desc,
                        "genres": genres,
                        "content_type": content_type
                    }
                    movie["category_ids"] = self._infer_category_ids(movie)
                    self.movies.append(movie)
                self.movies = self._filter_movies_by_selected_categories(self.movies)
                self._compute_preferences()
                self._sort_movies_for_user()
                self.current_index = 0
                self.render_next_card()
            else:
                self.movies = []
                self.current_index = 0
                self.render_next_card()
        except Exception:
            self.show_discover_msg("Ошибка сети или backend недоступен")

    @mainthread
    def render_next_card(self):
        container = self.root.get_screen('main').ids.card_container
        container.clear_widgets()
        
        if self.current_index >= len(self.movies):
            self.show_discover_msg("Фильмы закончились. Выберите другие жанры.")
            return
            
        self.show_discover_msg("")
        m = self.movies[self.current_index]
        card = MovieCard(
            title=m["title"],
            poster=m["poster"],
            rating=m["rating"],
            desc=m["desc"]
        )
        card.movie_data = m
        container.add_widget(card)

    @mainthread
    def show_discover_msg(self, msg):
        self.root.get_screen('main').ids.discover_status.text = msg

    # ==========================================
    # РЎРІР°Р№РїС‹ (РљРЅРѕРїРєРё)
    # ==========================================
    def like_movie(self):
        if self.current_index < len(self.movies):
            movie = self.movies[self.current_index]
            self._add_local_favorite(movie)
            self._compute_preferences()
            threading.Thread(target=self._save_to_firestore, args=(movie,)).start()
            self.current_index += 1
            self.render_next_card()

    def dislike_movie(self):
        if self.current_index < len(self.movies):
            self.current_index += 1
            self.render_next_card()

    @mainthread
    def handle_card_swipe(self, direction):
        if direction == "right":
            self.like_movie()
        else:
            self.dislike_movie()

    # ==========================================
    # FIREBASE: Firestore (С‡РµСЂРµР· REST API)
    # ==========================================
    def _save_to_firestore(self, movie):
        if not self.id_token: return
        
        # Firestore REST DOC path
        doc_path = f"users/{self.local_id}/favorites/film_{movie['id']}"
        url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}?key={FIREBASE_API_KEY}"
        
        # Firestore JSON struct
        payload = {
            "fields": {
                "filmId": {"stringValue": movie["id"]},
                "title": {"stringValue": movie["title"]},
                "poster": {"stringValue": movie.get("poster", "")},
                "rating": {"stringValue": self._normalize_rating(movie.get("rating", "-"))},
                "desc": {"stringValue": self._normalize_desc(movie.get("desc", ""))},
                "genres": {"stringValue": ", ".join(movie.get("genres", []))},
                "type": {"stringValue": movie.get("content_type", "FILM")}
            }
        }
        
        headers = {"Authorization": f"Bearer {self.id_token}"}
        try:
            res = requests.patch(url, json=payload, headers=headers, verify=False, timeout=20)
            if res.status_code >= 400 and not self.firestore_warned:
                self.firestore_warned = True
                if "Firestore API has not been used" in res.text:
                    print("Cloud Firestore API выключен: избранное сохраняется локально")
                else:
                    print("Избранное сохранено локально, облачная синхронизация недоступна")
        except Exception as e:
            print("Firestore save error:", e)

    def load_favorites(self):
        self.root.get_screen('main').ids.fav_status.text = "Загрузка..."
        self.root.get_screen('main').ids.fav_grid.clear_widgets()
        if not self.id_token:
            self.render_favorites()
            self.show_fav_msg("Требуется авторизация")
            return
        threading.Thread(target=self._fetch_firestore).start()

    def _fetch_firestore(self):
        if not self.id_token:
            return
        collection_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/users/{self.local_id}/favorites?key={FIREBASE_API_KEY}"
        headers = {"Authorization": f"Bearer {self.id_token}"}

        try:
            res = requests.get(collection_url, headers=headers, verify=False, timeout=20)
            if res.status_code == 200:
                data = res.json()
                docs = data.get("documents", [])

                self.favorites_db = []
                for doc in docs:
                    fields = doc.get("fields", {})
                    item = {
                        "id": fields.get("filmId", {}).get("stringValue", ""),
                        "title": fields.get("title", {}).get("stringValue", "No title"),
                        "poster": fields.get("poster", {}).get("stringValue", ""),
                        "rating": fields.get("rating", {}).get("stringValue", "-"),
                        "desc": fields.get("desc", {}).get("stringValue", "Description is unavailable"),
                        "genres": self._normalize_genres(fields.get("genres", {}).get("stringValue", "")),
                        "content_type": fields.get("type", {}).get("stringValue", "FILM"),
                    }
                    item["category_ids"] = self._infer_category_ids(item)
                    self.favorites_db.append(item)
                    self._add_local_favorite(item)
                self._compute_preferences()
                self.render_favorites()
            else:
                self.render_favorites()
                self.show_fav_msg("Не удалось загрузить избранное (облако)")
        except Exception:
            self.render_favorites()
            self.show_fav_msg("Ошибка сети: избранное из облака недоступно")

    @mainthread
    def render_favorites(self):
        grid = self.root.get_screen('main').ids.fav_grid
        grid.clear_widgets()

        items = self.favorites_db if self.favorites_db else self.local_favorites
        if not items:
            self.show_fav_msg("Favorites are empty")
            return

        self.show_fav_msg("")
        for f in items:
            film = dict(f)
            card = FavoriteCard(
                orientation="vertical",
                size_hint_y=None,
                height="220dp",
                radius=[15],
                ripple_behavior=True,
                md_bg_color=(0.12, 0.12, 0.12, 1)
            )
            from kivymd.uix.fitimage import FitImage
            img = FitImage(source=f.get("poster", ""), radius=[15, 15, 0, 0], size_hint_y=None, height="170dp")
            lbl = MDLabel(
                text=(f.get("title") or "No title"),
                halign="center",
                size_hint_y=None,
                height="50dp",
                font_style="Caption",
                shorten=True,
                shorten_from="right"
            )

            card.movie_data = film
            card.add_widget(img)
            card.add_widget(lbl)
            grid.add_widget(card)

    def open_movie_details(self, film):
        self.details_movie_id = str(film.get("id", ""))
        details_screen = self.root.get_screen('details')
        details_screen.ids.details_title.text = film.get("title", "No title")
        details_screen.ids.details_rating.text = f"Rating: {self._normalize_rating(film.get('rating', '-'))}"
        details_screen.ids.details_meta.text = ""
        details_screen.ids.details_desc.text = film.get("desc", "Загрузка...")
        details_screen.ids.details_poster.source = film.get("poster", "")
        self.root.current = "details"

        if self.details_movie_id:
            threading.Thread(target=self._load_details_full, args=(self.details_movie_id,)).start()

    def _load_details_full(self, film_id):
        details = self._fetch_movie_details_backend(film_id)
        if details:
            self._apply_details(details)

    @mainthread
    def _apply_details(self, details):
        if self.root.current != "details":
            return
        details_screen = self.root.get_screen('details')
        title = details.get("nameRu") or details.get("nameEn") or details.get("nameOriginal") or "No title"
        rating = self._normalize_rating(details.get("ratingKinopoisk") or details.get("rating"))
        year = str(details.get("year") or "")
        genres = ", ".join([g.get("genre", "") for g in details.get("genres", []) if g.get("genre")])
        full_desc = self._normalize_desc(details.get("description") or details.get("shortDescription"))
        poster = details.get("posterUrl") or details.get("posterUrlPreview") or ""

        details_screen.ids.details_title.text = title
        details_screen.ids.details_rating.text = f"Rating: {rating}"
        details_screen.ids.details_meta.text = f"{year} {'- ' + genres if genres else ''}".strip()
        details_screen.ids.details_desc.text = full_desc
        if poster:
            details_screen.ids.details_poster.source = poster

    @mainthread
    def back_to_main(self):
        self.root.current = "main"

    @mainthread
    def show_fav_msg(self, msg):
        self.root.get_screen('main').ids.fav_status.text = msg

    def _add_local_favorite(self, movie):
        movie_id = str(movie.get("id", ""))
        if not movie_id or movie_id in self.local_favorite_ids:
            return
        genres = movie.get("genres") if isinstance(movie.get("genres"), list) else self._normalize_genres(movie.get("genres", ""))
        content_type = movie.get("content_type") or self._infer_content_type(movie.get("type"), genres)
        normalized = {
            "id": movie_id,
            "title": movie.get("title", "No title"),
            "poster": movie.get("poster", ""),
            "rating": self._normalize_rating(movie.get("rating", "-")),
            "desc": self._normalize_desc(movie.get("desc", "")),
            "genres": genres,
            "content_type": content_type,
        }
        normalized["category_ids"] = movie.get("category_ids") or self._infer_category_ids(normalized)
        self.local_favorite_ids.add(movie_id)
        self.local_favorites.append(normalized)

if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings() # РћС‚РєР»СЋС‡Р°РµРј warning РїСЂРѕ SSL
    FeelFilmApp().run()


