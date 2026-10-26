export type MovieMeta = {
  director?: string;
  cast: string[];
  language?: string;
  runtime?: number;
  originalTitle?: string;
  keywords?: string[];
  rating?: number;
};

export const MOVIE_META: Record<string, MovieMeta> = {
  "adavi ramudu::1977": {
    "cast": [
      "N. T. Rama Rao",
      "Jayaprada",
      "Jayasudha",
      "Satyanarayana"
    ],
    "language": "Telugu",
    "runtime": 159,
    "director": "K. Raghavendra Rao"
  },
  "adavi ramudu::2004": {
    "cast": [
      "Prabhas",
      "Aarthi Agarwal",
      "Kota Srinivasa Rao",
      "Brahmanandam"
    ],
    "language": "Telugu",
    "director": "B. Gopal"
  },
  "amelie::2001": {
    "director": "Jean-Pierre Jeunet",
    "cast": [
      "Audrey Tautou",
      "Mathieu Kassovitz",
      "Rufus",
      "Jamel Debbouze",
      "Claire Maurier",
      "Isabelle Nanty"
    ],
    "language": "French",
    "runtime": 122,
    "originalTitle": "Le fabuleux destin d'Amélie Poulain"
  },
  "baahubali 2 the conclusion::2017": {
    "cast": [
      "Prabhas",
      "Rana Daggubati",
      "Anushka Shetty",
      "Tamannaah Bhatia",
      "Ramya Krishnan"
    ],
    "language": "Telugu",
    "runtime": 167,
    "director": "S. S. Rajamouli"
  },
  "baahubali the beginning::2015": {
    "director": "S. S. Rajamouli",
    "cast": [
      "Prabhas",
      "Rana Daggubati",
      "Anushka Shetty",
      "Tamannaah Bhatia",
      "Ramya Krishnan"
    ],
    "language": "Telugu",
    "runtime": 159
  },
  "batman::1966": {
    "director": "Leslie H. Martinson",
    "cast": [
      "Adam West",
      "Burt Ward",
      "Lee Meriwether",
      "Cesar Romero",
      "Burgess Meredith",
      "Frank Gorshin"
    ],
    "language": "English",
    "runtime": 105
  },
  "batman::1989": {
    "director": "Tim Burton",
    "cast": [
      "Jack Nicholson",
      "Michael Keaton",
      "Kim Basinger",
      "Michael Gough",
      "Pat Hingle",
      "Billy Dee Williams"
    ],
    "language": "English",
    "runtime": 126
  },
  "clueless::1995": {
    "director": "Amy Heckerling",
    "cast": [
      "Alicia Silverstone",
      "Stacey Dash",
      "Brittany Murphy",
      "Paul Rudd",
      "Donald Faison",
      "Elisa Donovan"
    ],
    "language": "English",
    "runtime": 97
  },
  "dark knight::2008": {
    "director": "Christopher Nolan",
    "cast": [
      "Christian Bale",
      "Heath Ledger",
      "Aaron Eckhart",
      "Michael Caine",
      "Maggie Gyllenhaal",
      "Gary Oldman"
    ],
    "language": "English",
    "runtime": 152
  },
  "eega::2012": {
    "cast": [
      "Nani",
      "Samantha Ruth Prabhu",
      "Sudeep"
    ],
    "language": "Telugu",
    "runtime": 145,
    "director": "S. S. Rajamouli"
  },
  "fight club::1999": {
    "director": "David Fincher",
    "cast": [
      "Edward Norton",
      "Brad Pitt",
      "Meat Loaf",
      "Jared Leto",
      "Helena Bonham Carter",
      "Zach Grenier"
    ],
    "language": "English",
    "runtime": 139
  },
  "forrest gump::1994": {
    "director": "Robert Zemeckis",
    "cast": [
      "Tom Hanks",
      "Robin Wright",
      "Gary Sinise",
      "Mykelti Williamson",
      "Sally Field",
      "Michael Conner Humphreys"
    ],
    "language": "English",
    "runtime": 142
  },
  "gladiator::2000": {
    "director": "Ridley Scott",
    "cast": [
      "Russell Crowe",
      "Joaquin Phoenix",
      "Connie Nielsen",
      "Oliver Reed",
      "Richard Harris",
      "Derek Jacobi"
    ],
    "language": "English",
    "runtime": 155
  },
  "godfather part ii::1974": {
    "director": "Francis Ford Coppola",
    "cast": [
      "Al Pacino",
      "Robert Duvall",
      "Diane Keaton",
      "Robert De Niro",
      "John Cazale",
      "Talia Shire"
    ],
    "language": "English",
    "runtime": 200
  },
  "godfather part iii::1990": {
    "director": "Francis Ford Coppola",
    "cast": [
      "Al Pacino",
      "Diane Keaton",
      "Andy García",
      "Talia Shire",
      "Sofia Coppola",
      "Eli Wallach"
    ],
    "language": "English",
    "runtime": 162
  },
  "godfather::1972": {
    "director": "Francis Ford Coppola",
    "cast": [
      "Marlon Brando",
      "Al Pacino",
      "James Caan",
      "Richard S. Castellano",
      "Robert Duvall",
      "Sterling Hayden"
    ],
    "language": "English",
    "runtime": 175
  },
  "inception::2010": {
    "director": "Christopher Nolan",
    "cast": [
      "Leonardo DiCaprio",
      "Joseph Gordon-Levitt",
      "Ellen Page",
      "Tom Hardy",
      "Ken Watanabe",
      "Cillian Murphy"
    ],
    "language": "English",
    "runtime": 148
  },
  "interstellar::2014": {
    "director": "Christopher Nolan",
    "cast": [
      "Matthew McConaughey",
      "Jessica Chastain",
      "Anne Hathaway",
      "Michael Caine",
      "Casey Affleck",
      "Mackenzie Foy"
    ],
    "language": "English",
    "runtime": 169
  },
  "jaws::1975": {
    "director": "Steven Spielberg",
    "cast": [
      "Roy Scheider",
      "Robert Shaw",
      "Richard Dreyfuss",
      "Lorraine Gary",
      "Murray Hamilton",
      "Carl Gottlieb"
    ],
    "language": "English",
    "runtime": 124
  },
  "jurassic park::1993": {
    "director": "Steven Spielberg",
    "cast": [
      "Sam Neill",
      "Laura Dern",
      "Jeff Goldblum",
      "Richard Attenborough",
      "Bob Peck",
      "Martin Ferrero"
    ],
    "language": "English",
    "runtime": 127
  },
  "lion king::1994": {
    "director": "Roger Allers",
    "cast": [
      "Jonathan Taylor Thomas",
      "Matthew Broderick",
      "James Earl Jones",
      "Jeremy Irons",
      "Moira Kelly",
      "Niketa Calame"
    ],
    "language": "English",
    "runtime": 89
  },
  "magadheera::2009": {
    "cast": [
      "Ram Charan",
      "Kajal Aggarwal",
      "Dev Gill",
      "Srihari"
    ],
    "language": "Telugu",
    "runtime": 166,
    "director": "S. S. Rajamouli"
  },
  "matrix::1999": {
    "director": "The Wachowskis",
    "cast": [
      "Keanu Reeves",
      "Laurence Fishburne",
      "Carrie-Anne Moss",
      "Hugo Weaving"
    ],
    "language": "English",
    "runtime": 136
  },
  "pulp fiction::1994": {
    "director": "Quentin Tarantino",
    "cast": [
      "John Travolta",
      "Samuel L. Jackson",
      "Uma Thurman",
      "Bruce Willis",
      "Ving Rhames",
      "Harvey Keitel"
    ],
    "language": "English",
    "runtime": 154
  },
  "shawshank redemption::1994": {
    "director": "Frank Darabont",
    "cast": [
      "Tim Robbins",
      "Morgan Freeman",
      "Bob Gunton",
      "Clancy Brown",
      "Mark Rolston",
      "James Whitmore"
    ],
    "language": "English",
    "runtime": 142
  },
  "spirited away::2001": {
    "director": "Hayao Miyazaki",
    "cast": [
      "Rumi Hiiragi",
      "Miyu Irino",
      "Mari Natsuki",
      "Takashi Naito",
      "Yasuko Sawaguchi",
      "Tatsuya Gashûin"
    ],
    "language": "Japanese",
    "runtime": 125,
    "originalTitle": "千と千尋の神隠し"
  },
  "star wars episode iv a new hope::1977": {
    "director": "George Lucas",
    "cast": [
      "Mark Hamill",
      "Harrison Ford",
      "Carrie Fisher",
      "Alec Guinness",
      "Peter Cushing"
    ],
    "language": "English",
    "runtime": 121
  },
  "titanic::1997": {
    "director": "James Cameron",
    "cast": [
      "Kate Winslet",
      "Leonardo DiCaprio",
      "Frances Fisher",
      "Billy Zane",
      "Kathy Bates",
      "Gloria Stuart"
    ],
    "language": "English",
    "runtime": 194
  },
  "toy story::1995": {
    "director": "John Lasseter",
    "cast": [
      "Tom Hanks",
      "Tim Allen",
      "Don Rickles",
      "Jim Varney",
      "Wallace Shawn",
      "John Ratzenberger"
    ],
    "language": "English",
    "runtime": 81
  }
};
